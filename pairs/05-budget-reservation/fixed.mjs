import { createBudget as real } from '../../src/budget.mjs';

export function createBudget({ maxTokensPerWindow = 1000 }) {
  const budget = real({ maxTokensPerRequest: maxTokensPerWindow, maxTokensPerWindow });
  return {
    check(identity, estimate) {
      // The probe works in tokens rather than messages, so a message whose
      // estimate is the figure asked for is synthesised here. estimateTokens
      // is roughly length/4 plus a quarter per word, and four per message, so
      // a single unbroken run of characters gives a predictable figure.
      return budget.check(identity, [{ content: 'x'.repeat(Math.max(0, (estimate - 5) * 4)) }]);
    },
    settle: (identity, receipt, tokens) => budget.settle(identity, receipt, tokens),
    release: (identity, receipt) => budget.release(identity, receipt),
    used: (identity) => budget.used(identity),
  };
}
