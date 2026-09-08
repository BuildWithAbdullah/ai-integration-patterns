import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJSON, requestStructured, StructuredError } from '../src/structured.mjs';

const schema = {
  type: 'object',
  required: ['sentiment', 'confidence'],
  properties: {
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

test('plain JSON parses', () => {
  assert.deepEqual(extractJSON('{"a":1}'), { a: 1 });
});

test('a fenced code block is unwrapped', () => {
  assert.deepEqual(extractJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJSON('```\n{"a":1}\n```'), { a: 1 });
});

test('a preamble before the object is skipped', () => {
  assert.deepEqual(extractJSON('Sure, here you go:\n{"a":1}\nHope that helps.'), { a: 1 });
});

test('nested braces and braces inside strings do not confuse the scan', () => {
  const text = 'Result: {"note":"a } inside a string","inner":{"b":2}} done';
  assert.deepEqual(extractJSON(text), { note: 'a } inside a string', inner: { b: 2 } });
});

test('an escaped quote inside a string is handled', () => {
  const raw = 'x {"note":"she said ' + String.fromCharCode(92) + '"hello' + String.fromCharCode(92) + '" then left"} y';
  assert.equal(extractJSON(raw).note, 'she said "hello" then left');
});

test('truncation is reported as truncation, not as bad JSON', () => {
  // This distinction matters: truncation is a token budget problem, and asking
  // the same question again with the same budget produces the same result.
  assert.throws(
    () => extractJSON('{"sentiment":"positive","note":"the customer was very '),
    (err) => err instanceof StructuredError && /token limit/.test(err.message)
  );
});

test('text with no object at all is refused', () => {
  assert.throws(() => extractJSON('I cannot help with that.'), /no JSON object/);
});

test('a valid first response is returned without a repair', async () => {
  let calls = 0;
  const result = await requestStructured({
    schema,
    ask: async () => { calls++; return '{"sentiment":"positive","confidence":0.9}'; },
  });
  assert.deepEqual(result.value, { sentiment: 'positive', confidence: 0.9 });
  assert.equal(result.attempts, 1);
  assert.equal(calls, 1);
});

test('a schema violation triggers exactly one repair attempt', async () => {
  const seen = [];
  const responses = [
    '{"sentiment":"quite good","confidence":0.9}',
    '{"sentiment":"positive","confidence":0.9}',
  ];
  const result = await requestStructured({
    schema,
    ask: async (suffix) => { seen.push(suffix); return responses.shift(); },
  });

  assert.equal(result.attempts, 2);
  assert.deepEqual(seen[0], [], 'the first attempt carries no repair context');
  assert.equal(seen[1][0].role, 'assistant');
  assert.match(seen[1][1].content, /must be one of positive, neutral, negative/,
    'the repair prompt must say what was actually wrong');
});

test('repairs are bounded, so a failing request fails fast rather than expensively', async () => {
  let calls = 0;
  await assert.rejects(
    () => requestStructured({ schema, ask: async () => { calls++; return 'never valid'; } }),
    StructuredError
  );
  assert.equal(calls, 2, 'one attempt and one repair, then stop');
});

test('maxRepairs 0 means one attempt', async () => {
  let calls = 0;
  await assert.rejects(
    () => requestStructured({ schema, maxRepairs: 0, ask: async () => { calls++; return 'nope'; } }),
    StructuredError
  );
  assert.equal(calls, 1);
});
