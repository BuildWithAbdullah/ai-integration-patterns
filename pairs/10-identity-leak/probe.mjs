const CLIENTS = 500;

export async function probe(impl) {
  const observed = new Set();
  let clock = 0;
  const budget = impl.createBudget({ windowMs: 1000, now: () => clock });

  for (let i = 0; i < CLIENTS; i++) budget.record(`198.51.100.${i}`, 10);
  clock += 5000; // every entry is now well outside the window

  if (budget.identities() > 0) observed.add('prevented.identity-map-leak');
  return observed;
}
