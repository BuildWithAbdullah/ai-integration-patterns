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
 */

import { validate, ToolError } from './tools.mjs';

export class StructuredError extends Error {
  constructor(message, { cause, raw } = {}) {
    super(message);
    this.name = 'StructuredError';
    this.cause = cause;
    this.raw = raw;
  }
}

/** Pull an object out of a response that may be fenced or prefaced. */
export function extractJSON(text) {
  const trimmed = String(text).trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch (error) {
    // Fall back to the first balanced object in the text. Deliberately not a
    // regex: matching balanced braces with one is a well known way to be
    // subtly wrong about nested structures.
    const start = candidate.indexOf('{');
    if (start === -1) throw new StructuredError('no JSON object in response', { cause: error, raw: text });

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (escaped) { escaped = false; continue; }
      if (ch === String.fromCharCode(92)) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      if (ch === '}' && --depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch (inner) {
          throw new StructuredError('response contained malformed JSON', { cause: inner, raw: text });
        }
      }
    }
    throw new StructuredError('JSON object in response was never closed, which usually means the response hit the token limit', { cause: error, raw: text });
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
 */
export async function requestStructured({ schema, ask, maxRepairs = 1 }) {
  let lastError;
  let messagesSuffix = [];

  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const raw = await ask(messagesSuffix);
    try {
      const parsed = extractJSON(raw);
      validate(schema, parsed, 'response');
      return { value: parsed, attempts: attempt + 1 };
    } catch (error) {
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

  throw new StructuredError(`could not obtain a valid structured response: ${lastError?.message}`, { cause: lastError });
}
