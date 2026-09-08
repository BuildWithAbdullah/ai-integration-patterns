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
  const s = String(text);
  if (!s) return 0;
  return Math.ceil(s.length / 4) + Math.ceil(s.split(/\s+/).filter(Boolean).length * 0.25);
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

  const usedIn = (identity) => {
    const cutoff = now() - windowMs;
    const entries = (windows.get(identity) ?? []).filter((e) => e.at > cutoff);
    windows.set(identity, entries);
    return entries.reduce((sum, e) => sum + e.tokens, 0);
  };

  return {
    /** Called before the request. Throws rather than returning a flag, because
     *  a budget check whose result can be ignored will be. */
    check(identity, messages) {
      const estimate = estimateMessages(messages);
      if (estimate > maxTokensPerRequest) {
        throw new BudgetError('request is larger than the per-request ceiling', {
          scope: 'request', limit: maxTokensPerRequest, used: estimate,
        });
      }
      const used = usedIn(identity);
      if (used + estimate > maxTokensPerWindow) {
        throw new BudgetError('identity has exhausted its budget for this window', {
          scope: 'window', limit: maxTokensPerWindow, used,
        });
      }
      return { estimate, used };
    },

    /** Called after the request, with the provider's own usage figure. The
     *  estimate got you through the door; this is what is actually recorded. */
    record(identity, tokens) {
      const entries = windows.get(identity) ?? [];
      entries.push({ at: now(), tokens });
      windows.set(identity, entries);
      return usedIn(identity);
    },

    used: usedIn,
  };
}
