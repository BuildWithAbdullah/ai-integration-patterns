import { parseSSE, textDeltas as deltas } from '../../src/stream.mjs';

export async function* textDeltas(stream) {
  yield* deltas(parseSSE(stream));
}
