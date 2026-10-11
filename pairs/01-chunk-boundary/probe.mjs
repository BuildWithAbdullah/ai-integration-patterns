/**
 * Split one real event stream at every byte offset and see whether the whole
 * message comes back. Splitting at one chosen offset would be a test of that
 * offset; the defect is a property of the boundary, so the probe sweeps it.
 */
const WORDS = ['The ', 'quick ', 'brown ', 'fox ', 'jumps'];

function encode() {
  const frames = WORDS.map((w) => `data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`);
  frames.push('data: [DONE]\n\n');
  return new TextEncoder().encode(frames.join(''));
}

function splitAt(bytes, at) {
  return (async function* () {
    yield bytes.slice(0, at);
    yield bytes.slice(at);
  })();
}

export async function probe(impl) {
  const bytes = encode();
  const expected = WORDS.join('');
  const observed = new Set();

  for (let at = 1; at < bytes.length; at++) {
    let text = '';
    for await (const delta of impl.textDeltas(splitAt(bytes, at))) text += delta;
    if (text !== expected) {
      observed.add('prevented.chunk-boundary-split');
      break;
    }
  }
  return observed;
}
