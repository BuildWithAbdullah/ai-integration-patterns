import { createBudget as real } from '../../src/budget.mjs';

export function createBudget({ windowMs = 1000, now = () => Date.now() }) {
  const budget = real({ windowMs, now, maxTokensPerRequest: 1e9, maxTokensPerWindow: 1e9 });
  return {
    record(identity, tokens) {
      const { receipt } = budget.check(identity, [{ content: '' }]);
      return budget.settle(identity, receipt, tokens);
    },
    used: (identity) => budget.used(identity),
    identities: () => budget.identities(),
  };
}
