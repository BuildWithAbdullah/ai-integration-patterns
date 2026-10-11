/**
 * The validator this repository shipped for three weeks.
 *
 * `key in value` is the natural way to write "does this object have this
 * property", and it is wrong on a trust boundary, because `in` walks the
 * prototype chain. Every object inherits constructor, toString, valueOf and
 * hasOwnProperty from Object.prototype.
 */
export function validate(schema, value, path = 'arguments') {
  const fail = (msg) => { const e = new Error(`${path} ${msg}`); e.name = 'ToolError'; throw e; };
  if (schema.type !== 'object') return value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('must be an object');
  for (const key of schema.required ?? []) {
    if (!(key in value)) fail(`is missing required property "${key}"`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in (schema.properties ?? {}))) fail(`has unexpected property "${key}"`);
    }
  }
  return value;
}
