/**
 * client.mjs
 *
 * The transport layer: timeouts, retries, backoff, and a hard line between
 * errors worth retrying and errors that will fail identically forever.
 *
 * Everything that varies is injected: fetch, the clock, sleep, and the random
 * source. That is not ceremony. A retry policy whose behaviour depends on real
 * time and real randomness cannot be tested, so in practice it never is, and
 * the first time anyone finds out what it does under load is under load.
 */

export class TransientError extends Error {
  constructor(message, { status, retryAfterMs } = {}) {
    super(message);
    this.name = 'TransientError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class PermanentError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'PermanentError';
    this.status = status;
    this.body = body;
  }
}

// 429 is rate limiting and 5xx is the provider having a bad minute. Both are
// worth trying again. 400 and 422 mean the request itself is wrong, and 401 and
// 403 mean the credential is wrong; retrying any of those is a slower way to
// receive the same answer, and on 429 it is a way to make things worse.
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

function parseRetryAfter(headerValue, nowMs) {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(headerValue);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

/**
 * Full jitter: a random point in [0, cap], not cap itself. Deterministic
 * backoff synchronises every client that failed at the same moment into
 * retrying at the same moment, which is how a provider blip becomes an outage.
 */
export function backoffMs(attempt, { baseMs = 500, maxMs = 20000, random = Math.random } = {}) {
  const cap = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(random() * cap);
}

export function createClient({
  apiKey,
  baseUrl = 'https://api.openai.com/v1',
  fetchImpl = globalThis.fetch,
  timeoutMs = 30000,
  maxRetries = 3,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  random = Math.random,
} = {}) {
  if (!apiKey) throw new Error('apiKey is required; read it from the environment, never from the client');

  async function once(path, body, { signal } = {}) {
    // Two abort sources: the caller's signal, and our own timeout. A request
    // with no timeout is a request that can hang for as long as the socket
    // stays open, which on a serverless platform means paying for it.
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.ok) return response;

      const text = await response.text().catch(() => '');
      if (RETRYABLE_STATUS.has(response.status)) {
        throw new TransientError(`upstream returned ${response.status}`, {
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers?.get?.('retry-after'), now()),
        });
      }
      throw new PermanentError(`upstream returned ${response.status}`, {
        status: response.status,
        body: text,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function request(path, body, { signal } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await once(path, body, { signal });
      } catch (error) {
        // A caller who aborted wants to stop, not to be retried at.
        if (signal?.aborted) throw error;
        if (error instanceof PermanentError) throw error;

        lastError = error;
        if (attempt === maxRetries) break;

        // Retry-After is the provider telling you exactly how long to wait.
        // Backing off less than it asks is how a rate limit becomes a ban.
        const wait = error.retryAfterMs ?? backoffMs(attempt, { random });
        await sleep(wait);
      }
    }
    throw lastError;
  }

  return { request, once };
}
