const HOUR_IN_SECONDS = '3600';

function rateLimited() {
  return async () => ({
    ok: false,
    status: 429,
    text: async () => '',
    headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? HOUR_IN_SECONDS : null) },
  });
}

export async function probe(impl) {
  const observed = new Set();
  const slept = [];
  const client = impl.createClient({ sleep: async (ms) => { slept.push(ms); }, fetchImpl: rateLimited(), maxRetries: 1 });

  let thrown;
  try { await client.request('/chat', {}); } catch (error) { thrown = error; }

  // A request handler held open for more than a minute on the provider's word
  // is the failure, whatever it is eventually held open for.
  if (slept.some((ms) => ms > 60000)) observed.add('prevented.unbounded-retry-after');

  // The residual. Returning promptly frees the worker and does not get the
  // user an answer, and the pair asserts that the figure survives so that
  // something upstream can act on it rather than guess.
  if (thrown && thrown.retryAfterMs === 3600000) observed.add('residual.work-still-not-done');

  return observed;
}
