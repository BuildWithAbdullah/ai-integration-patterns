/**
 * The first streaming parser everybody writes.
 *
 * It reads a chunk, splits it on blank lines, and parses what it finds. In
 * development this works, because responses are short enough to arrive in one
 * read. In production a single event routinely spans two reads, and this throws
 * away both halves.
 */
export async function* textDeltas(stream) {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk);
    for (const frame of text.split(/\r?\n\r?\n/)) {
      const line = frame.split(/\r?\n/).find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // The half event is dropped here, and this is the whole defect. The
        // user sees an answer with words missing and nothing is logged.
      }
    }
  }
}
