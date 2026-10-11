/**
 * The abort check this repository shipped: once per iteration of a for-await.
 *
 * It reads as though it cancels. It can only run when an event arrives, and
 * the case that matters is the one where no event is arriving.
 */
export async function* textDeltas(events, { signal } = {}) {
  for await (const event of events) {
    if (signal?.aborted) return;
    if (event.done) return;
    const delta = event.data?.choices?.[0]?.delta?.content;
    if (delta) yield delta;
  }
}
