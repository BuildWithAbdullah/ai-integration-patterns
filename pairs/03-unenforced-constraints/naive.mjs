/**
 * A validator that supports some keywords and ignores the rest.
 *
 * Nobody writes this on purpose. It happens because maxLength was needed first
 * and minLength was not, and nothing ever told anybody that the schema they
 * wrote afterwards was half decorative.
 */
export function validate(schema, value, path = 'arguments') {
  const fail = (msg) => { const e = new Error(`${path} ${msg}`); e.name = 'ToolError'; throw e; };
  if (schema.type === 'string') {
    if (typeof value !== 'string') fail('must be a string');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail('too long');
    return value;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('must be an array');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail('too many items');
    return value;
  }
  // Anything else, including a misspelled type, passes.
  return value;
}
