import { createClient as real } from '../../src/client.mjs';

export function createClient({ sleep, fetchImpl, maxRetries = 1 }) {
  return real({ apiKey: 'test', sleep, fetchImpl, maxRetries, maxRetryAfterMs: 20000, deadlineMs: 90000 });
}
