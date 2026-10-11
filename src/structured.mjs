/**
 * structured.mjs
 *
 * Getting a usable object back, and deciding what to do when you do not.
 *
 * Even with a schema enforced by the provider, the failure modes that reach
 * production are: the model wrapped the JSON in a code fence, it wrote a
 * sentence before the object, it emitted valid JSON that does not satisfy your
 * constraints, or the response was truncated at the token limit and the JSON
 * is cut off mid-string.
 *
 * The last one is worth separating out, because it is the one people try to
 * fix with a repair prompt. Truncation is not a comprehension failure. It is a
 * budget failure, and asking again with the same budget produces the same
 * truncation at a slightly different point.
 *
 * That paragraph was in this file from the first commit, and the code under it
 * did the opposite. `requestStructured` treated every StructuredError as
 * repairable, truncation included, so the one failure the module singles out as
 * not worth a second attempt was the one it spent a second attempt on. It is
 * now a distinct error type and the repair path refuses it.
 */

import { validate, ToolError, SchemaError } from './tools.mjs';

export class StructuredError extends Error {
  constructor(message, { cause, raw } = {}) {
    super(message);
    this.name = 'StructuredError';
    this.cause = cause;
    this.raw = raw;
  }
}

/**
 * The response stopped mid-value. Asking again with the same token limit gets
 * the same answer slightly further along, so this is not repairable by
 * prompting. Raise the limit, ask for less, or split the work.
 */
export class TruncatedError extends StructuredError {
  constructor(message, options) {
    super(message, options);
    this.name = 'TruncatedError';
  }
}

const OPENERS = { '{': '}', '[': ']' };

/**
 * Pull a value out of a response that may be fenced or prefaced.
 *
 * Arrays count. The first version scanned for `{` only, so a schema with an
 * array at its root, which is an ordinary thing to ask a model for, failed
 * with "no JSON object in response" on a reply that contained a perfectly good
 * array one sentence in.
 */
export function extractJSON(text) {
  const trimmed = String(text).trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch (error) {
    // Fall back to the first balanced object or array in the text.
    // Deliberately not a regex: matching balanced brackets with one is a well
    // known way to be subtly wrong about nested structures.
    let start = -1;
    for (let i = 0; i < candidate.length; i++) {
      if (candidate[i] === '{' || candidate[i] === '[') { start = i; break; }
    }
    if (start === -1) throw new StructuredError('no JSON object or array in response', { cause: error, raw: text });

    const opener = candidate[start];
    const closer = OPENERS[opener];
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (escaped) { escaped = false; continue; }
      if (ch === String.fromCharCode(92)) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === opener) depth++;
      else if (ch === closer && --depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch (inner) {
          throw new StructuredError('response contained malformed JSON', { cause: inner, raw: text });
        }
      }
    }

    // Unclosed, or closed inside a string literal that never ended. Either way
    // the response ran out before the value did.
    throw new TruncatedError(
      `the JSON ${opener === '{' ? 'object' : 'array'} in the response was never closed, which usually means the response hit the token limit`,
      { cause: error, raw: text },
    );
  }
}

/**
 * Ask for a structured result, validate it, and on a validation failure try
 * exactly once more with the error fed back.
 *
 * Once, not until it works. An unbounded repair loop turns a request that was
 * going to fail into a request that fails slowly and costs several times as
 * much, and the retry that eventually succeeds is usually the one that quietly
 * dropped a field. Two attempts, then give the caller a real error and let it
 * degrade.
 *
 * Three classes of failure, three answers:
 *
 *   ToolError         the model misunderstood the shape. Worth one repair.
 *   StructuredError   the model wrapped or prefaced it. Worth one repair.
 *   TruncatedError    the budget was too small. Repairing it spends money to
 *                     receive the same answer, so it is raised immediately.
 *   SchemaError       the schema is wrong. Nobody's prompt can fix that, and
 *                     it should have failed at startup.
 */
export async function requestStructured({ schema, ask, maxRepairs = 1 }) {
  let lastError;
  let messagesSuffix = [];
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const raw = await ask(messagesSuffix);
    attempts = attempt + 1;
    try {
      const parsed = extractJSON(raw);
      validate(schema, parsed, 'response');
      return { value: parsed, attempts };
    } catch (error) {
      if (error instanceof SchemaError) throw error;
      if (error instanceof TruncatedError) throw error;

      lastError = error;
      const isRepairable = error instanceof ToolError || error instanceof StructuredError;
      if (!isRepairable || attempt === maxRepairs) break;

      messagesSuffix = [
        { role: 'assistant', content: String(raw).slice(0, 2000) },
        {
          role: 'user',
          content: `That response could not be used: ${error.message}. Reply with JSON matching the schema and nothing else.`,
        },
      ];
    }
  }

  throw new StructuredError(`could not obtain a valid structured response after ${attempts} attempts: ${lastError?.message}`, { cause: lastError });
}
