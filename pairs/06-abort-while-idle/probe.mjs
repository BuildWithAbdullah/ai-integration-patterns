const STALL_MS = 250;

/** One event, then a long silence, then more. The tab closes during the silence. */
function stalledStream(state) {
  return (async function* () {
    try {
      yield { done: false, data: { choices: [{ delta: { content: 'partial answer' } }] } };
      await new Promise((r) => setTimeout(r, STALL_MS));
      state.keptGenerating = true;
      yield { done: false, data: { choices: [{ delta: { content: ' that nobody will read' } }] } };
    } finally {
      state.cancelledAt = Date.now();
    }
  })();
}

export async function probe(impl) {
  const observed = new Set();
  const controller = new AbortController();
  const state = {};
  const startedAt = Date.now();

  for await (const delta of impl.textDeltas(stalledStream(state), { signal: controller.signal })) {
    void delta;
    controller.abort();
  }
  const returnedAfter = Date.now() - startedAt;

  // Abort fired on the first delta. Returning only once the stall was over
  // means the cancellation waited for the thing it was meant to cancel.
  if (returnedAfter >= STALL_MS || state.keptGenerating) observed.add('prevented.abort-ignored-while-idle');

  // The residual, asserted rather than asserted away: this process stops
  // reading, and whether the provider stops producing is not observable here.
  observed.add('residual.provider-bills-until-hangup');
  return observed;
}
