/**
 * An extractor that scans for an object and nothing else.
 *
 * An array at the root of a structured response is an ordinary request: give
 * me the five tags, give me the rows. A reply of "Here are the tags: [...]"
 * came back as "no JSON object in response", which sends the reader looking
 * for a prompt problem that is not there.
 */
export function extractJSON(text) {
  const trimmed = String(text).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try { return JSON.parse(candidate); } catch (error) {
    const start = candidate.indexOf('{');
    if (start === -1) { const e = new Error('no JSON object in response'); e.name = 'StructuredError'; throw e; }
    let depth = 0;
    for (let i = start; i < candidate.length; i++) {
      if (candidate[i] === '{') depth++;
      if (candidate[i] === '}' && --depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
    const e = new Error('never closed'); e.name = 'StructuredError'; throw e;
  }
}
