import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, backoffMs, TransientError, PermanentError } from '../src/client.mjs';

// A fake transport. Every test below runs with no network, no key and no clock,
// which is the point: a retry policy you cannot test deterministically is a
// retry policy whose behaviour you find out about during an incident.
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (typeof next === 'function') return next();
    return next;
  };
  impl.calls = calls;
  return impl;
}

const response = (status, body = '', headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  headers: { get: (k) => headers[k.toLowerCase()] },
});

const clientWith = (fetchImpl, overrides = {}) =>
  createClient({
    apiKey: 'test-key',
    fetchImpl,
    sleep: async () => {},
    random: () => 0.5,
    ...overrides,
  });

test('an API key is required, and is never defaulted', () => {
  assert.throws(() => createClient({}), /apiKey is required/);
});

test('a successful response is returned without retrying', async () => {
  const fetchImpl = fakeFetch([response(200, 'ok')]);
  const client = clientWith(fetchImpl);
  const res = await client.request('/chat/completions', { model: 'x' });
  assert.equal(res.status, 200);
  assert.equal(fetchImpl.calls.length, 1);
});

test('the key travels in the Authorization header and not in the URL', async () => {
  const fetchImpl = fakeFetch([response(200)]);
  await clientWith(fetchImpl).request('/chat/completions', {});
  const { url, init } = fetchImpl.calls[0];
  assert.equal(init.headers.authorization, 'Bearer test-key');
  assert.ok(!url.includes('test-key'), 'the key must never appear in a URL, where it lands in logs');
});

test('a 500 is retried and the eventual success is returned', async () => {
  const fetchImpl = fakeFetch([response(500), response(503), response(200, 'ok')]);
  const res = await clientWith(fetchImpl).request('/chat/completions', {});
  assert.equal(res.status, 200);
  assert.equal(fetchImpl.calls.length, 3);
});

test('a 400 is not retried, because it will fail identically forever', async () => {
  const fetchImpl = fakeFetch([response(400, 'bad request')]);
  await assert.rejects(
    () => clientWith(fetchImpl).request('/chat/completions', {}),
    (err) => err instanceof PermanentError && err.status === 400
  );
  assert.equal(fetchImpl.calls.length, 1);
});

test('a 401 is not retried either', async () => {
  const fetchImpl = fakeFetch([response(401, 'unauthorized')]);
  await assert.rejects(() => clientWith(fetchImpl).request('/x', {}), PermanentError);
  assert.equal(fetchImpl.calls.length, 1);
});

test('retries stop at maxRetries and the transient error surfaces', async () => {
  const fetchImpl = fakeFetch([response(429), response(429), response(429), response(429)]);
  await assert.rejects(
    () => clientWith(fetchImpl, { maxRetries: 3 }).request('/x', {}),
    (err) => err instanceof TransientError && err.status === 429
  );
  assert.equal(fetchImpl.calls.length, 4, 'one attempt plus three retries');
});

test('Retry-After in seconds is honoured instead of the backoff curve', async () => {
  const waits = [];
  const fetchImpl = fakeFetch([response(429, '', { 'retry-after': '7' }), response(200)]);
  const client = clientWith(fetchImpl, { sleep: async (ms) => waits.push(ms) });
  await client.request('/x', {});
  assert.deepEqual(waits, [7000], 'the provider said seven seconds, so wait seven seconds');
});

test('Retry-After as an HTTP date is honoured', async () => {
  const waits = [];
  const base = Date.parse('2026-01-01T00:00:00Z');
  const fetchImpl = fakeFetch([
    response(503, '', { 'retry-after': new Date(base + 5000).toUTCString() }),
    response(200),
  ]);
  await clientWith(fetchImpl, { now: () => base, sleep: async (ms) => waits.push(ms) }).request('/x', {});
  assert.deepEqual(waits, [5000]);
});

test('backoff is jittered across the whole window, not fixed', () => {
  assert.equal(backoffMs(0, { baseMs: 1000, random: () => 0 }), 0);
  assert.equal(backoffMs(0, { baseMs: 1000, random: () => 1 }), 1000);
  assert.equal(backoffMs(3, { baseMs: 1000, random: () => 1 }), 8000);
  assert.equal(backoffMs(9, { baseMs: 1000, maxMs: 20000, random: () => 1 }), 20000, 'capped');

  // Full jitter exists so that a thousand clients failing together do not all
  // retry together. Fixed backoff turns a blip into a synchronised stampede.
  const spread = new Set(Array.from({ length: 50 }, (_, i) => backoffMs(4, { random: () => i / 50 })));
  assert.ok(spread.size > 40, 'delays should be spread, not clustered');
});

test('a caller abort is not retried around', async () => {
  const controller = new AbortController();
  const fetchImpl = fakeFetch([
    () => { controller.abort(); throw new Error('aborted'); },
    response(200),
  ]);
  await assert.rejects(() => clientWith(fetchImpl).request('/x', {}, { signal: controller.signal }));
  assert.equal(fetchImpl.calls.length, 1, 'a user who cancelled should not be retried at');
});

test('a request that never resolves is aborted by the timeout', async () => {
  const fetchImpl = async (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')));
    });
  await assert.rejects(
    () => clientWith(fetchImpl, { timeoutMs: 10, maxRetries: 0 }).request('/x', {}),
    /timeout|aborted/
  );
});
