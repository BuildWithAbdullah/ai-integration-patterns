/**
 * Check, then await, then record. The shape almost every rate limiter and
 * budget starts as, and it has no effect at all under concurrency: between the
 * check and the record the recorded total has not moved, so every request in
 * flight measures itself against the same number.
 */
export function createBudget({ maxTokensPerWindow = 1000 }) {
  let used = 0;
  return {
    check(_identity, estimate) {
      if (used + estimate > maxTokensPerWindow) {
        const e = new Error('identity has exhausted its budget for this window');
        e.name = 'BudgetError';
        throw e;
      }
      return { estimate, receipt: null };
    },
    settle(_identity, _receipt, tokens) { used += tokens; return used; },
    release() { return used; },
    used: () => used,
  };
}
