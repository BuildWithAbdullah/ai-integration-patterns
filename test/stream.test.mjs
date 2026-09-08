import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSSE, textDeltas } from '../src/stream.mjs';

async function* fromChunks(chunks) {
  for (const chunk of chunks) yield chunk;
}

const collect = async (iter) => {
  const out = [];
  for await (const item of iter) out.push(item);
  return out;
};

const frame = (content) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

test('complete events in one chunk are parsed', async () => {
  const events = await collect(parseSSE(fromChunks([frame('Hello'), frame(' world'), 'data: [DONE]\n\n'])));
  assert.equal(events.length, 3);
  assert.equal(events[2].done, true);
});

test('an event split across two chunks is reassembled', async () => {
  // This is the case that works in development and fails in production. The
  // split is placed mid-JSON deliberately.
  const whole = frame('Hello');
  const cut = Math.floor(whole.length / 2);
  const events = await collect(parseSSE(fromChunks([whole.slice(0, cut), whole.slice(cut)])));
  assert.equal(events.length, 1);
  assert.equal(events[0].data.choices[0].delta.content, 'Hello');
});

test('several events arriving in one chunk are all yielded', async () => {
  const events = await collect(parseSSE(fromChunks([frame('a') + frame('b') + frame('c')])));
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((e) => e.data.choices[0].delta.content), ['a', 'b', 'c']);
});

test('a multi-byte character split across chunks survives', async () => {
  // The emoji is four bytes. Splitting it and decoding each half without
  // stream: true produces replacement characters, which reach the user.
  const bytes = new TextEncoder().encode(frame('done 🎉'));
  const cut = bytes.length - 4;
  const events = await collect(parseSSE(fromChunks([bytes.slice(0, cut), bytes.slice(cut)])));
  assert.equal(events[0].data.choices[0].delta.content, 'done 🎉');
});

test('CRLF line endings are handled', async () => {
  const raw = `data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\r\n\r\n`;
  const events = await collect(parseSSE(fromChunks([raw])));
  assert.equal(events[0].data.choices[0].delta.content, 'x');
});

test('a final event with no trailing blank line is still emitted', async () => {
  const raw = `data: ${JSON.stringify({ choices: [{ delta: { content: 'tail' } }] })}`;
  const events = await collect(parseSSE(fromChunks([raw])));
  assert.equal(events.length, 1);
  assert.equal(events[0].data.choices[0].delta.content, 'tail');
});

test('a malformed frame is dropped rather than ending the stream', async () => {
  const events = await collect(parseSSE(fromChunks([frame('a'), 'data: {not json\n\n', frame('b')])));
  assert.deepEqual(events.map((e) => e.data.choices[0].delta.content), ['a', 'b']);
});

test('comment and empty lines are ignored', async () => {
  const events = await collect(parseSSE(fromChunks([': keep-alive\n\n', frame('a')])));
  assert.equal(events.length, 1);
});

test('textDeltas stops at [DONE]', async () => {
  const events = parseSSE(fromChunks([frame('a'), 'data: [DONE]\n\n', frame('never')]));
  assert.deepEqual(await collect(textDeltas(events)), ['a']);
});

test('textDeltas stops when the caller aborts', async () => {
  const controller = new AbortController();
  async function* events() {
    yield { done: false, data: { choices: [{ delta: { content: 'a' } }] } };
    controller.abort();
    yield { done: false, data: { choices: [{ delta: { content: 'b' } }] } };
  }
  // Everything after the abort is generation the user closed the tab on and is
  // still being billed for.
  assert.deepEqual(await collect(textDeltas(events(), { signal: controller.signal })), ['a']);
});
