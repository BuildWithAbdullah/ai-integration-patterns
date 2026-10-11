/**
 * A repair loop that cannot tell a shape it did not understand from a response
 * that ran out of room.
 *
 * The file this came from opens by explaining the difference. The code treated
 * both the same, so the one failure the module singles out as not worth
 * retrying is the one it retried.
 */
import { extractJSON, StructuredError } from '../../src/structured.mjs';
import { validate, ToolError } from '../../src/tools.mjs';

export async function requestStructured({ schema, ask, maxRepairs = 1 }) {
  let lastError;
  let suffix = [];
  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const raw = await ask(suffix);
    try {
      const parsed = extractJSON(raw);
      validate(schema, parsed, 'response');
      return { value: parsed, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      const repairable = error instanceof ToolError || error instanceof StructuredError;
      if (!repairable || attempt === maxRepairs) break;
      suffix = [{ role: 'user', content: `That response could not be used: ${error.message}` }];
    }
  }
  throw new StructuredError(`could not obtain a valid structured response: ${lastError?.message}`);
}
