/**
 * Every rejected finding in the catalogue, driven out of a real call against a
 * real module, with set equality asserted in both directions.
 *
 * The both-ways part is what makes the file worth having. One direction says
 * every id in the catalogue can actually happen, which stops the catalogue
 * becoming a wish list. The other says nothing happened that the catalogue
 * does not list, which stops a module growing an error path nobody wrote down.
 *
 * Before this existed, several of these paths had never been observed to fire,
 * and four of the defects fixed in this repository were in them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FINDINGS, byKind, find } from '../tools/catalogue.mjs';
import { createRegistry, validate, assertSchema, ToolError, SchemaError } from '../src/tools.mjs';
import { createBudget, BudgetError } from '../src/budget.mjs';
import { createClient, TransientError, PermanentError, RetryLaterError, DeadlineError } from '../src/client.mjs';
import { extractJSON, requestStructured, StructuredError, TruncatedError } from '../src/structured.mjs';
import { PAIRS, load } from '../pairs/index.mjs';

const nothing = async () => ({});
const register = (schema) => createRegistry().register('t', { schema, handler: nothing });
const call = (schema, args) => register(schema).run({ name: 't', arguments: args });

/**
 * Each case names a finding and does the thing that produces it. The value is a
 * function so that a case which cannot throw shows up as a failure rather than
 * as a case that was never run.
 */
const CASES = {
  // schema
  'schema.missing': () => createRegistry().register('t', { handler: nothing }),
  'schema.nameless-tool': () => createRegistry().register('', { schema: {}, handler: nothing }),
  'schema.handler-not-a-function': () => createRegistry().register('t', { schema: {}, handler: 'not a function' }),
  'schema.not-an-object': () => assertSchema('a string'),
  'schema.unknown-type': () => assertSchema({ type: 'strng' }),
  'schema.unenforced-keyword': () => assertSchema({ type: 'string', format: 'email' }),
  'schema.untyped-but-constrained': () => assertSchema({ minLength: 3 }),
  'schema.unsatisfiable-required': () => assertSchema({ type: 'object', additionalProperties: false, properties: { a: { type: 'string' } }, required: ['b'] }),

  // arguments
  'args.not-an-object': () => validate({ type: 'object' }, [1, 2]),
  'args.missing-required': () => validate({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, {}),
  'args.unexpected-property': () => validate({ type: 'object', additionalProperties: false, properties: { id: { type: 'string' } } }, { id: 'a', extra: 1 }),
  'args.too-few-properties': () => validate({ type: 'object', minProperties: 2 }, { a: 1 }),
  'args.too-many-properties': () => validate({ type: 'object', maxProperties: 1 }, { a: 1, b: 2 }),
  'args.not-an-array': () => validate({ type: 'array', items: { type: 'string' } }, 'nope'),
  'args.too-few-items': () => validate({ type: 'array', minItems: 2, items: { type: 'string' } }, ['one']),
  'args.too-many-items': () => validate({ type: 'array', maxItems: 1, items: { type: 'string' } }, ['one', 'two']),
  'args.duplicate-items': () => validate({ type: 'array', uniqueItems: true, items: { type: 'string' } }, ['a', 'a']),
  'args.not-a-string': () => validate({ type: 'string' }, 42),
  'args.too-short': () => validate({ type: 'string', minLength: 8 }, 'short'),
  'args.too-long': () => validate({ type: 'string', maxLength: 3 }, 'longer'),
  'args.pattern-mismatch': () => validate({ type: 'string', pattern: '^ord_[0-9]+$' }, 'ord_abc'),
  'args.not-a-number': () => validate({ type: 'number' }, Number.POSITIVE_INFINITY),
  'args.not-an-integer': () => validate({ type: 'integer' }, 1.5),
  'args.below-minimum': () => validate({ type: 'number', minimum: 10 }, 9),
  'args.above-maximum': () => validate({ type: 'number', maximum: 10 }, 11),
  'args.not-above-exclusive-minimum': () => validate({ type: 'number', exclusiveMinimum: 0 }, 0),
  'args.not-below-exclusive-maximum': () => validate({ type: 'number', exclusiveMaximum: 1 }, 1),
  'args.not-a-multiple': () => validate({ type: 'integer', multipleOf: 5 }, 7),
  'args.not-a-boolean': () => validate({ type: 'boolean' }, 'true'),
  'args.not-null': () => validate({ type: 'null' }, 0),
  'args.not-in-enum': () => validate({ type: 'string', enum: ['refund', 'replace'] }, 'delete'),
  'args.not-the-const': () => validate({ type: 'string', const: 'v1' }, 'v2'),

  // tool call
  'tool.unknown-name': () => register({}).run({ name: 'never_registered', arguments: '{}' }),
  'tool.arguments-not-json': () => call({}, '{not json'),

  // budget
  'budget.request-over-ceiling': () => createBudget({ maxTokensPerRequest: 10 }).check('ip', [{ content: 'x'.repeat(400) }]),
  'budget.window-exhausted': () => {
    const budget = createBudget({ maxTokensPerRequest: 1e6, maxTokensPerWindow: 100 });
    budget.check('ip', [{ content: 'x'.repeat(400) }]);
    return budget.check('ip', [{ content: 'x'.repeat(400) }]);
  },
  'budget.unknown-receipt': () => createBudget().settle('ip', 'r999', 10),

  // transport
  'transport.transient-status': async () => {
    const client = createClient({ apiKey: 'k', maxRetries: 1, sleep: async () => {},
      fetchImpl: async () => ({ ok: false, status: 503, text: async () => '', headers: { get: () => null } }) });
    return client.request('/chat', {});
  },
  'transport.permanent-status': async () => {
    const client = createClient({ apiKey: 'k', sleep: async () => {},
      fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'bad key', headers: { get: () => null } }) });
    return client.request('/chat', {});
  },
  'transport.retry-after-too-long': async () => {
    const client = createClient({ apiKey: 'k', maxRetries: 2, maxRetryAfterMs: 1000, sleep: async () => {},
      fetchImpl: async () => ({ ok: false, status: 429, text: async () => '', headers: { get: (h) => (h === 'retry-after' ? '600' : null) } }) });
    return client.request('/chat', {});
  },
  'transport.deadline-before-attempt': async () => {
    let clock = 0;
    const client = createClient({ apiKey: 'k', deadlineMs: 50, now: () => (clock += 100), sleep: async () => {},
      fetchImpl: async () => ({ ok: true }) });
    return client.request('/chat', {});
  },
  'transport.deadline-before-retry': async () => {
    let clock = 0;
    const client = createClient({ apiKey: 'k', maxRetries: 3, deadlineMs: 400, baseMs: 10000, maxMs: 10000,
      random: () => 1, now: () => clock, sleep: async (ms) => { clock += ms; },
      fetchImpl: async () => { clock += 100; return { ok: false, status: 503, text: async () => '', headers: { get: () => null } }; } });
    return client.request('/chat', {});
  },

  // structured
  'structured.no-json': () => extractJSON('I am afraid I cannot help with that.'),
  'structured.malformed-json': () => extractJSON('here you go: {"a": 1,, }'),
  'structured.truncated': () => extractJSON('{"summary": "it began well and then ran ou'),
  'structured.unusable-after-repair': () => requestStructured({
    schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    ask: async () => '{"wrong": true}',
    maxRepairs: 1,
  }),
};

const EXPECTED_TYPE = {
  schema: SchemaError,
  args: ToolError,
  tool: ToolError,
  budget: BudgetError,
  structured: StructuredError,
};

test('every rejected finding in the catalogue is produced by a real call', async (t) => {
  const observed = new Set();

  for (const [id, run] of Object.entries(CASES)) {
    await t.test(id, async () => {
      const entry = find(id);
      assert.ok(entry, `${id} is in the cases but not in the catalogue`);
      assert.equal(entry.kind, 'rejected', `${id} is catalogued as ${entry.kind} but driven as rejected`);

      let error;
      try { await run(); } catch (thrown) { error = thrown; }
      assert.ok(error, `${id} produced no error, so the path it describes is not reachable`);

      const group = id.split('.')[0];
      if (group === 'transport') {
        assert.ok(
          error instanceof TransientError || error instanceof PermanentError
            || error instanceof RetryLaterError || error instanceof DeadlineError,
          `${id} threw ${error.name}, which is not a transport error`,
        );
      } else {
        assert.ok(error instanceof EXPECTED_TYPE[group], `${id} threw ${error.name}, expected ${EXPECTED_TYPE[group].name}`);
      }
      assert.ok(error.message.length > 0, `${id} threw an error with no message`);
      observed.add(id);
    });
  }

  // Both directions. A catalogued id with no case, and a case with no
  // catalogue entry, are each a failure.
  const catalogued = byKind('rejected');
  assert.deepEqual([...observed].sort(), [...catalogued].sort(),
    'the set of rejected findings driven here must equal the set catalogued');
});

test('every prevented and residual finding belongs to a pair that observes it', async () => {
  const declared = new Set([...byKind('prevented'), ...byKind('residual')]);
  const seen = new Set();

  for (const pair of PAIRS) {
    const { naive, fixed, probe } = await load(pair);
    for (const id of await probe(naive)) seen.add(id);
    for (const id of await probe(fixed)) seen.add(id);
  }

  assert.deepEqual([...seen].sort(), [...declared].sort(),
    'every prevented and residual id must be observed by some pair, and no pair may observe one that is not catalogued');
});

test('the catalogue is internally consistent', () => {
  const ids = FINDINGS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate finding id');

  for (const finding of FINDINGS) {
    assert.match(finding.id, /^[a-z]+\.[a-z0-9-]+$/, `${finding.id} is not group.slug`);
    assert.ok(finding.summary && finding.summary.length > 20, `${finding.id} needs a real summary`);
    assert.ok(['rejected', 'prevented', 'residual'].includes(finding.kind), `${finding.id} has an unknown kind`);
    if (finding.kind === 'rejected') {
      assert.equal(finding.pair, undefined, `${finding.id} is rejected and should not name a pair`);
    } else {
      assert.ok(PAIRS.some((p) => p.id === finding.pair), `${finding.id} names pair ${finding.pair}, which does not exist`);
    }
  }
});
