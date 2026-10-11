/**
 * stream.mjs
 *
 * Server-sent event parsing for a streamed completion.
 *
 * The part that is always wrong in a first implementation: chunks do not
 * arrive on event boundaries. A single read can contain half an event, three
 * events, or the middle of a multi-byte character. Parsing each chunk in
 * isolation works in development, where responses are small and fast, and
 * produces intermittent JSON errors in production, where they are not.
 *
 * So: decode with a streaming decoder, buffer, and only ever consume complete
 * events terminated by a blank line.
 */

const EVENT_BOUNDARY = /\r?\n\r?\n/;

/** A sentinel, so that an abort cannot be confused with an iterator result. */
const ABORTED = Symbol('aborted');

export async function* parseSSE(stream, { decoder = new TextDecoder() } = {}) {
  let buffer = '';

  for await (const chunk of stream) {
    // stream: true is what keeps a character split across two chunks intact.
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });

    let boundary;
    while ((boundary = buffer.search(EVENT_BOUNDARY)) !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      const separator = buffer.slice(boundary).match(EVENT_BOUNDARY)[0];
      buffer = buffer.slice(boundary + separator.length);

      const parsed = parseEvent(rawEvent);
      if (parsed !== undefined) yield parsed;
    }
  }

  // Flush the decoder. Without this, a stream that ends on an incomplete
  // multi-byte sequence drops it silently instead of producing the
  // replacement character, so a truncated response looks like a clean one.
  buffer += decoder.decode();

  // Whatever is left once the stream closes, in case the final event was not
  // followed by a blank line.
  const tail = parseEvent(buffer);
  if (tail !== undefined) yield tail;
}

export function parseEvent(raw) {
  const dataLines = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    // One optional leading space is stripped, per the event stream format, and
    // nothing else. The payload here is JSON so trimming would be harmless,
    // but a provider that streams raw text would have its indentation eaten.
    .map((line) => (line.charAt(5) === ' ' ? line.slice(6) : line.slice(5)));

  if (dataLines.length === 0) return undefined;

  const data = dataLines.join('\n');
  if (data.trim() === '[DONE]') return { done: true };

  try {
    return { done: false, data: JSON.parse(data) };
  } catch {
    // A malformed frame is dropped rather than thrown. One bad event should not
    // end a response the user is already reading.
    return undefined;
  }
}

/**
 * Turn a parsed event stream into text deltas, and stop cleanly when the caller
 * aborts.
 *
 * Aborting matters more here than anywhere else in this repository. A user who
 * closes the tab mid-answer is still being billed for every token the provider
 * generates until somebody hangs up. Without an abort path that is every
 * abandoned request on the site, and it is invisible until the invoice.
 *
 * The first version of this function checked `signal.aborted` once per
 * iteration of a `for await`, which means it checked only when an event
 * arrived. A stream that has gone quiet is the exact case that matters: the
 * tab is closed, no events are coming, and the loop is parked on the next
 * read. The check could not fire until the thing it was waiting to cancel
 * happened by itself. Racing the abort against the read is the difference
 * between an abort path and the appearance of one, and `pairs/06` fails
 * without it.
 */
export async function* textDeltas(events, { signal } = {}) {
  const iterator = events[Symbol.asyncIterator] ? events[Symbol.asyncIterator]() : events;

  // Hand the cancellation upstream without waiting for it. This is what closes
  // the response body, which is what stops this process reading tokens nobody
  // will see. It is deliberately not awaited: `return()` on an async generator
  // that is parked on an await does not settle until that await finishes, so
  // awaiting it here would make cancelling the stall wait for the stall. That
  // is the defect this function had, in a slightly different place, and the
  // first attempt at the fix reintroduced it. `pairs/06` catches both.
  const cancel = () => { try { iterator.return?.()?.then?.(() => {}, () => {}); } catch { /* already finished */ } };

  if (signal?.aborted) { cancel(); return; }

  let onAbort;
  const aborted = signal
    ? new Promise((resolve) => {
        onAbort = () => resolve(ABORTED);
        signal.addEventListener('abort', onAbort, { once: true });
      })
    : null;

  try {
    for (;;) {
      // Checked before the pull, not after it. Checking after means the
      // iterator has already been resumed, which on a provider stream is the
      // read we are trying not to make.
      if (signal?.aborted) { cancel(); return; }

      const settled = aborted ? await Promise.race([iterator.next(), aborted]) : await iterator.next();

      if (settled === ABORTED) { cancel(); return; }
      if (settled.done) return;

      const event = settled.value;
      if (event?.done) return;
      const delta = event?.data?.choices?.[0]?.delta?.content;
      if (delta !== undefined && delta !== null && delta !== '') yield delta;
    }
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}
