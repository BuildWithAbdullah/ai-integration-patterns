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

  // Whatever is left once the stream closes, in case the final event was not
  // followed by a blank line.
  const tail = parseEvent(buffer);
  if (tail !== undefined) yield tail;
}

function parseEvent(raw) {
  const dataLines = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());

  if (dataLines.length === 0) return undefined;

  const data = dataLines.join('\n');
  if (data === '[DONE]') return { done: true };

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
 */
export async function* textDeltas(events, { signal } = {}) {
  for await (const event of events) {
    if (signal?.aborted) return;
    if (event.done) return;
    const delta = event.data?.choices?.[0]?.delta?.content;
    if (delta) yield delta;
  }
}
