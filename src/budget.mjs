/**
 * budget.mjs
 *
 * A ceiling, and a way to notice you are approaching it.
 *
 * The failure this prevents is specific and common: a feature ships, it works,
 * nobody watches it, and the first signal that something is wrong is an invoice
 * at the end of the month. By then the cause is a month old.
 *
 * Two independent controls, because they fail differently.
 *
 * A per-request cap stops one pathological request. Usually that is a very
 * large document pasted into a summariser, or a retrieval step that matched
 * more than it should and stuffed the context.
 *
 * A per-identity window stops a loop. That is a script hammering an endpoint,
 * or a user who found the feature entertaining. A per-request cap does nothing
 * about ten thousand individually reasonable requests.
 *
 * Neither knows anything about prices. Rates change and vary by model, so they
 * belong in configuration you can edit without a deploy, not in a source file
 * that will be stale within months.
 *
 * The thing to understand before using this is the reservation. The first
 * version checked the window and returned; the caller then awaited a request
 * and recorded afterwards. Between those two points the recorded usage had not
 * moved, so every concurrent request for the same identity measured itself
 * against the same stale total and every one of them passed. A ceiling of
 * 1000 tokens admitted three requests of 805 each, which is to say it admitted
 * anything, as long as it arrived at once. `check` now reserves the estimate
 * immediately and hands back a receipt; `settle` replaces the estimate with
 * the provider's own figure, and `release` drops it if the request never ran.
 */

export class BudgetError extends Error {
  constructor(message, { scope, limit, used } = {}) {
    super(message);
    this.name = 'BudgetError';
    this.scope = scope;
    this.limit = limit;
    this.used = used;
  }
}

/**
 * A deliberately rough token estimate for pre-flight checks only.
 *
 * It is wrong. Real tokenisation depends on the model's vocabulary, and this
 * approximation drifts furthest on exactly the inputs that matter: code, JSON,
 * and languages that are not English. It is here to catch the request that is
 * ten times too big before it is sent, not to bill anyone. Reconcile against
 * the usage the provider returns, which is the only authoritative number.
 */
export function estimateTokens(text) {
  const s = typeof text === 'string' ? text : stringifyContent(text);
  if (!s) return 0;
  return Math.ceil(s.length / 4) + Math.ceil(s.split(/\s+/).filter(Boolean).length * 0.25);
}

/**
 * Content is a string on the completions shape and an array of blocks on the
 * messages shape. The first version called String() on it, which turns an
 * array of blocks into `[object Object],[object Object]` and estimates a long
 * document at eleven tokens. Estimating low is the dangerous direction for a
 * pre-flight check, because the whole point is to refuse before sending.
 */
function stringifyContent(content) {
  if (content == null) return '';
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (typeof block === 'string') return block;
      if (block && typeof block === 'object') return String(block.text ?? JSON.stringify(block));
      return String(block);
    }).join('\n');
  }
  if (typeof content === 'object') return JSON.stringify(content);
  return String(content);
}

export function estimateMessages(messages) {
  // The per-message overhead is a constant because the real value is
  // model-specific. Being consistently slightly high is the safe direction.
  return messages.reduce((total, m) => total + estimateTokens(m.content) + 4, 0);
}

export function createBudget({
  maxTokensPerRequest = 8000,
  maxTokensPerWindow = 100000,
  windowMs = 60 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  const windows = new Map();
  let receipts = 0;

  /**
   * Prune and total in one pass, and delete the identity when nothing is left.
   *
   * The delete is not tidiness. Keyed on a client address, the first version
   * pruned the entries inside each identity and never removed the identity, so
   * a Map key was retained for every address ever seen. On a public endpoint
   * that is an unbounded leak in a process that is meant to stay up for weeks,
   * and it is invisible until the heap is.
   */
  const total = (identity) => {
    const cutoff = now() - windowMs;
    const entries = (windows.get(identity) ?? []).filter((e) => e.at > cutoff);
    if (entries.length === 0) windows.delete(identity);
    else windows.set(identity, entries);
    return entries.reduce((sum, e) => sum + e.tokens, 0);
  };

  return {
    /**
     * Called before the request. Throws rather than returning a flag, because
     * a budget check whose result can be ignored will be.
     *
     * On success the estimate is already counted against the identity. The
     * returned receipt must be passed to `settle` or `release`, or the
     * estimate stays on the books until the window rolls past it. That is the
     * safe direction to fail in: a leaked reservation throttles one identity,
     * where a missing one throttles nobody.
     */
    check(identity, messages) {
      const estimate = estimateMessages(messages);
      if (estimate > maxTokensPerRequest) {
        throw new BudgetError('request is larger than the per-request ceiling', {
          scope: 'request', limit: maxTokensPerRequest, used: estimate,
        });
      }
      const used = total(identity);
      if (used + estimate > maxTokensPerWindow) {
        throw new BudgetError('identity has exhausted its budget for this window', {
          scope: 'window', limit: maxTokensPerWindow, used,
        });
      }

      const receipt = `r${++receipts}`;
      const entries = windows.get(identity) ?? [];
      entries.push({ at: now(), tokens: estimate, receipt, pending: true });
      windows.set(identity, entries);
      return { estimate, used, receipt };
    },

    /**
     * Called after the request, with the provider's own usage figure. The
     * estimate got you through the door; this is what is actually recorded.
     */
    settle(identity, receipt, tokens) {
      const entries = windows.get(identity) ?? [];
      const entry = entries.find((e) => e.receipt === receipt && e.pending);
      // Settled entries keep their receipt rather than dropping it, so that
      // settling twice is an error the caller hears about instead of a figure
      // silently counted twice.
      if (!entry) throw new BudgetError('no such open reservation; it was already settled, released, or has aged out of the window', { scope: 'receipt' });
      entry.tokens = tokens;
      entry.pending = false;
      return total(identity);
    },

    /** The request never happened. Give the tokens back. */
    release(identity, receipt) {
      const entries = windows.get(identity) ?? [];
      const remaining = entries.filter((e) => e.receipt !== receipt);
      if (remaining.length === entries.length) return total(identity);
      windows.set(identity, remaining);
      return total(identity);
    },

    used: total,

    /** How many identities are currently held. Exposed so that the leak the
     *  first version had is something a test can see rather than something a
     *  reader has to take on trust. */
    identities() {
      for (const identity of [...windows.keys()]) total(identity);
      return windows.size;
    },
  };
}
