/**
 * Three requests arrive for one identity before any of them answers. A ceiling
 * that admits all three is not a ceiling.
 */
export async function probe(impl) {
  const observed = new Set();
  const budget = impl.createBudget({ maxTokensPerWindow: 1000 });

  const admitted = [];
  for (let i = 0; i < 3; i++) {
    try { admitted.push(budget.check('one-client', 400)); } catch { /* refused, which is the point */ }
  }

  if (admitted.length > 2) observed.add('prevented.unreserved-budget');
  return observed;
}
