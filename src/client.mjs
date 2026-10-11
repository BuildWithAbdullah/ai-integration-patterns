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

/**
 * Raised when the provider asked for a longer wait than this process is willing
 * to hold a request open for. It carries the figure the provider gave, so the
 * caller can queue the work, shed it, or answer without the model, rather than
 * being told only that something went wrong.
 */
export class RetryLaterError extends Error {
  constructor(message, { status, retryAfterMs } = {}) {
    super(message);
    this.name = 'RetryLaterError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class DeadlineError extends Error {
  constructor(message, { elapsedMs } = {}) {
    super(message);
    this.name = 'DeadlineError';
    this.elapsedMs = elapsedMs;
  }
}

// 429 is rate limiting and 5xx is the provider having a bad minute. 408 is a
// timeout the provider noticed before we did, and 409 is a conflict that is
// usually a concurrent write settling. All are worth trying again. 400 and 422
// mean the request itself is wrong, and 401 and 403 mean the credential is
// wrong; retrying any of those is a slower way to receive the same answer, and
// on 429 it is a way to make things worse.
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

export function parseRetryAfter(headerValue, nowMs) {
  if (headerValue === undefined || headerValue === null) return undefined;
  const text = String(headerValue).trim();
  if (text === '') return undefined;
  // Number('') is 0 and Number(' ') is 0, so the empty check has to come
  // first or a blank header reads as "retry immediately".
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(text);
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
  baseMs = 500,
  maxMs = 20000,
  // The longest this process will sit inside sleep() on the provider's
  // instruction. Past this, the request is handed back to the caller with the
  // figure attached. The first version obeyed Retry-After with no ceiling at
  // all, so a provider answering `Retry-After: 3600` parked a request handler
  // for an hour: one worker gone, one socket held, one user watching a spinner
  // until something else timed out. "Back off at least as long as you were
  // asked" is right, and it is not the same as "wait as long as you are told".
  maxRetryAfterMs = 20000,
  // A ceiling on the whole call. A 30 second per-attempt timeout with three
  // retries is a two minute worst case before backoff, which is not what
  // anyone reading `timeoutMs: 30000` believes they configured.
  deadlineMs = 90000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  random = Math.random,
} = {}) {
  if (!apiKey) throw new Error('apiKey is required; read it from the environment, never from the client');

  async function once(path, body, { signal, budgetMs = timeoutMs } = {}) {
    // Two abort sources: the caller's signal, and our own timeout. A request
    // with no timeout is a request that can hang for as long as the socket
    // stays open, which on a serverless platform means paying for it.
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('timeout')), Math.max(1, budgetMs));

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

      const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'), now());
      if (RETRYABLE_STATUS.has(response.status)) {
        throw new TransientError(`upstream returned ${response.status}`, { status: response.status, retryAfterMs });
      }
      // The body is only read on a permanent failure. On a retryable one it is
      // a rate limit notice nobody reads, and reading it costs a round trip on
      // the path that is already slow.
      const text = await response.text().catch(() => '');
      throw new PermanentError(`upstream returned ${response.status}`, { status: response.status, body: text });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function request(path, body, { signal } = {}) {
    const startedAt = now();
    const remaining = () => deadlineMs - (now() - startedAt);
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const left = remaining();
      if (left <= 0) throw new DeadlineError('ran out of time before the attempt could be made', { elapsedMs: now() - startedAt });

      try {
        return await once(path, body, { signal, budgetMs: Math.min(timeoutMs, left) });
      } catch (error) {
        // A caller who aborted wants to stop, not to be retried at.
        if (signal?.aborted) throw error;
        if (error instanceof PermanentError) throw error;

        lastError = error;
        if (attempt === maxRetries) break;

        // Retry-After is the provider telling you exactly how long to wait.
        // Backing off less than it asks is how a rate limit becomes a ban, so
        // the choice when it asks for too long is to stop, not to wait less.
        const asked = error.retryAfterMs;
        if (asked !== undefined && asked > maxRetryAfterMs) {
          throw new RetryLaterError(
            `provider asked for ${Math.round(asked / 1000)}s, which is longer than this client will hold a request open`,
            { status: error.status, retryAfterMs: asked },
          );
        }

        const wait = asked ?? backoffMs(attempt, { baseMs, maxMs, random });
        if (wait >= remaining()) {
          throw new DeadlineError('the next retry would land after the deadline', { elapsedMs: now() - startedAt });
        }
        await sleep(wait);
      }
    }
    throw lastError;
  }

  return { request, once };
}
