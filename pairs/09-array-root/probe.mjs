export async function probe(impl) {
  const observed = new Set();
  const cases = [
    'Here are the tags you asked for: ["one", "two", "three"]',
    'Sure.\n[{"id": 1}, {"id": 2}]\nLet me know if you want more.',
  ];

  for (const text of cases) {
    try {
      const value = impl.extractJSON(text);
      if (!Array.isArray(value)) observed.add('prevented.array-root-rejected');
    } catch {
      observed.add('prevented.array-root-rejected');
    }
  }
  return observed;
}
