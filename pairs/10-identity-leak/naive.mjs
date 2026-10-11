/**
 * A window that prunes the entries and keeps the key.
 *
 * Keyed on a client address, on a public endpoint, in a process that is meant
 * to stay up for weeks. The entries expire, the Map does not, and nothing
 * about the code looks like a leak.
 */
export function createBudget({ windowMs = 1000, now = () => Date.now() }) {
  const windows = new Map();
  const total = (identity) => {
    const cutoff = now() - windowMs;
    const entries = (windows.get(identity) ?? []).filter((e) => e.at > cutoff);
    windows.set(identity, entries);
    return entries.reduce((sum, e) => sum + e.tokens, 0);
  };
  return {
    record(identity, tokens) {
      const entries = windows.get(identity) ?? [];
      entries.push({ at: now(), tokens });
      windows.set(identity, entries);
      return total(identity);
    },
    used: total,
    identities() { for (const k of [...windows.keys()]) total(k); return windows.size; },
  };
}
