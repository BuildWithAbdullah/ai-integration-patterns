/**
 * A message builder with a redaction function beside it that nothing calls.
 *
 * This is the shape the defect actually had. `redact` existed, was exported,
 * was documented as redaction on the way in, and was dead code. Reviewing the
 * module would not catch it: the function is there and it works.
 */
import { sanitiseUntrusted, redact } from '../../src/boundary.mjs';

export { redact };

export function buildMessages({ instructions, untrusted = [], question }) {
  const messages = [{ role: 'system', content: instructions }];
  for (const source of untrusted) {
    messages.push({ role: 'user', content: `<<<UNTRUSTED_CONTENT>>> source=${JSON.stringify(String(source.label ?? 'unknown'))}\n${sanitiseUntrusted(source.text)}\n<<<UNTRUSTED_CONTENT>>>` });
  }
  if (question) messages.push({ role: 'user', content: String(question) });
  return messages;
}
