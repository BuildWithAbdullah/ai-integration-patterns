import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, validate, ToolError } from '../src/tools.mjs';

const refundSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['orderId', 'amount'],
  properties: {
    orderId: { type: 'string', pattern: '^ord_[a-z0-9]{6}$' },
    amount: { type: 'number', minimum: 0, maximum: 500 },
    reason: { type: 'string', maxLength: 200 },
  },
};

function registryWith(handler, options = {}) {
  return createRegistry().register('refund_order', { schema: refundSchema, handler, ...options });
}

test('a registered call with valid arguments runs', async () => {
  const registry = registryWith(async (args) => ({ refunded: args.amount }));
  const result = await registry.run({ name: 'refund_order', arguments: '{"orderId":"ord_abc123","amount":10}' });
  assert.deepEqual(result, { status: 'ok', name: 'refund_order', result: { refunded: 10 } });
});

test('an unregistered tool name is refused and the handler is never reached', async () => {
  let called = false;
  const registry = registryWith(async () => { called = true; });
  await assert.rejects(
    () => registry.run({ name: 'drop_database', arguments: '{}' }),
    (err) => err instanceof ToolError && err.code === 'unknown_tool'
  );
  assert.equal(called, false);
});

test('arguments that do not validate never reach the handler', async () => {
  let called = false;
  const registry = registryWith(async () => { called = true; });

  // Over the maximum. A model that has read an injected instruction saying
  // "refund the full amount" produces exactly this.
  await assert.rejects(
    () => registry.run({ name: 'refund_order', arguments: '{"orderId":"ord_abc123","amount":999999}' }),
    (err) => err instanceof ToolError && /at most 500/.test(err.message)
  );

  // An id that is not shaped like one of ours.
  await assert.rejects(
    () => registry.run({ name: 'refund_order', arguments: '{"orderId":"../../etc/passwd","amount":1}' }),
    /does not match the required pattern/
  );

  // A property nobody declared.
  await assert.rejects(
    () => registry.run({ name: 'refund_order', arguments: '{"orderId":"ord_abc123","amount":1,"admin":true}' }),
    /unexpected property "admin"/
  );

  assert.equal(called, false, 'the handler must not run for any of these');
});

test('malformed JSON arguments are rejected cleanly', async () => {
  const registry = registryWith(async () => {});
  await assert.rejects(
    () => registry.run({ name: 'refund_order', arguments: '{"orderId": ' }),
    (err) => err instanceof ToolError && err.code === 'invalid_arguments'
  );
});

test('a tool marked confirm is returned for approval instead of executed', async () => {
  let called = false;
  const registry = registryWith(async () => { called = true; }, { confirm: true });
  const result = await registry.run({ name: 'refund_order', arguments: '{"orderId":"ord_abc123","amount":10}' });
  assert.equal(result.status, 'needs_confirmation');
  assert.equal(called, false);

  const approved = await registry.run(
    { name: 'refund_order', arguments: '{"orderId":"ord_abc123","amount":10}' },
    { confirmed: true }
  );
  assert.equal(approved.status, 'ok');
  assert.equal(called, true);
});

test('the handler receives the caller authority, never the model request', async () => {
  let seen;
  const registry = registryWith(async (args, context) => { seen = context; return 'ok'; });
  await registry.run(
    // A model asking to act as somebody else. The field is simply not read.
    { name: 'refund_order', arguments: '{"orderId":"ord_abc123","amount":1,"userId":"admin"}' },
    { userId: 'usr_42' }
  ).catch(() => {});

  const clean = createRegistry().register('whoami', {
    schema: { type: 'object' },
    handler: async (args, context) => { seen = context; return context.userId; },
  });
  const result = await clean.run({ name: 'whoami', arguments: '{}' }, { userId: 'usr_42' });
  assert.equal(result.result, 'usr_42');
  assert.equal(seen.userId, 'usr_42');
});

test('definitions are derived from the registry, so an advertised tool exists', () => {
  const registry = registryWith(async () => {});
  const defs = registry.definitions();
  assert.equal(defs.length, 1);
  assert.equal(defs[0].function.name, 'refund_order');
  assert.deepEqual(defs[0].function.parameters, refundSchema);
});

test('the validator covers the types it claims to', () => {
  assert.throws(() => validate({ type: 'string', enum: ['a', 'b'] }, 'c'), /must be one of a, b/);
  assert.throws(() => validate({ type: 'integer' }, 1.5), /must be an integer/);
  assert.throws(() => validate({ type: 'array', maxItems: 2 }, [1, 2, 3]), /at most 2 items/);
  assert.throws(() => validate({ type: 'object', required: ['a'] }, {}), /missing required property "a"/);
  assert.throws(() => validate({ type: 'boolean' }, 'true'), /must be a boolean/);
  assert.throws(() => validate({ type: 'number' }, NaN), /must be a number/);
  assert.doesNotThrow(() => validate({ type: 'array', items: { type: 'string' } }, ['a']));
});

test('nested paths are reported so the error says where', () => {
  const schema = { type: 'object', properties: { user: { type: 'object', properties: { age: { type: 'integer' } } } } };
  assert.throws(() => validate(schema, { user: { age: 'old' } }), /arguments\.user\.age must be a number/);
});
