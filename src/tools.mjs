/**
 * tools.mjs
 *
 * Where the trust boundary is actually enforced.
 *
 * A model asking to call `refund_order` is a suggestion arriving over the
 * network, shaped by whatever text was in its context. It has the same standing
 * as a query string. The registry below treats it that way: the name must be
 * one you registered, the arguments must validate, and the handler runs with
 * the caller's own authority rather than the model's request.
 *
 * The rule that matters most is the last one. If a tool can only act on rows
 * the signed-in user already owns, then a successful prompt injection gets the
 * attacker the user's own data, which they had anyway.
 *
 * Two things in this file were wrong for the first three weeks it existed, and
 * both are the kind of wrong that a validator on a trust boundary cannot
 * afford. They are described in `docs/04-what-this-repository-got-wrong.md` and
 * each has a pair under `pairs/` that fails without the fix.
 */

export class ToolError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

/**
 * A bad schema is the operator's mistake, not the model's. It gets its own
 * error type so that it cannot be caught by a handler written to report
 * invalid arguments back to the model, and so that it cannot be mistaken for
 * something a repair prompt might fix.
 */
export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaError';
  }
}

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * The keywords this validator enforces, by type. Anything outside these sets
 * is rejected at validation time rather than ignored.
 *
 * That rule is the whole point. The first version of this file supported
 * `maxLength` and not `minLength`, and silently accepted an empty string
 * against `{ type: 'string', minLength: 8 }`. A validator that ignores a
 * constraint it was handed is worse than one that does not support it, because
 * the schema author reads their own schema and believes the rule is live. The
 * failure surfaces as a row in the database, not as an exception.
 */
const KEYWORDS = {
  object: new Set(['type', 'properties', 'required', 'additionalProperties', 'minProperties', 'maxProperties', 'description', 'title']),
  array: new Set(['type', 'items', 'minItems', 'maxItems', 'uniqueItems', 'description', 'title']),
  string: new Set(['type', 'enum', 'const', 'minLength', 'maxLength', 'pattern', 'description', 'title']),
  number: new Set(['type', 'enum', 'const', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'description', 'title']),
  integer: new Set(['type', 'enum', 'const', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'description', 'title']),
  boolean: new Set(['type', 'const', 'description', 'title']),
  null: new Set(['type', 'description', 'title']),
};

/**
 * Check the schema itself, once, before any value is measured against it.
 *
 * Call this at registration time so that a typo in a schema is a startup
 * failure rather than a request that quietly validates nothing. `{}` is the
 * one schema with no type, and it means "anything"; it has to be written
 * exactly that way, so that "anything" is a decision somebody made rather
 * than the result of misspelling `type`.
 */
export function assertSchema(schema, path = 'schema') {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new SchemaError(`${path} must be an object`);
  }

  const keys = Object.keys(schema);
  if (!own(schema, 'type')) {
    if (keys.length > 0) {
      throw new SchemaError(`${path} has no "type" but carries ${keys.map((k) => `"${k}"`).join(', ')}; an unconstrained schema must be written as {}`);
    }
    return schema;
  }

  const { type } = schema;
  if (!own(KEYWORDS, type)) {
    throw new SchemaError(`${path} has unknown type "${String(type)}"; supported types are ${Object.keys(KEYWORDS).join(', ')}`);
  }

  const allowed = KEYWORDS[type];
  for (const key of keys) {
    if (!allowed.has(key)) {
      throw new SchemaError(`${path} has keyword "${key}", which this validator does not enforce for type "${type}"; remove it or enforce it in the handler`);
    }
  }

  if (type === 'object') {
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      assertSchema(sub, `${path}.properties.${key}`);
    }
    for (const key of schema.required ?? []) {
      if (schema.additionalProperties === false && !own(schema.properties ?? {}, key)) {
        throw new SchemaError(`${path} requires "${key}" but does not declare it, and forbids additional properties, so nothing can satisfy it`);
      }
    }
  }

  if (type === 'array' && own(schema, 'items')) assertSchema(schema.items, `${path}.items`);

  return schema;
}

/**
 * Measure a value against a schema. Throws ToolError on the first failure,
 * because partial validation of a tool call is not a useful thing to report.
 *
 * `strict` defaults to true and checks the schema as well as the value. Pass
 * false only when the schema has already been through `assertSchema`, which is
 * what the registry does so that every request does not re-walk the schema.
 */
export function validate(schema, value, path = 'arguments', { strict = true } = {}) {
  if (strict) assertSchema(schema, `${path} schema`);
  return measure(schema, value, path);
}

function measure(schema, value, path) {
  const fail = (msg) => { throw new ToolError(`${path} ${msg}`, { code: 'invalid_arguments' }); };

  if (!own(schema, 'type')) return value;

  if (own(schema, 'const') && value !== schema.const) fail(`must be ${JSON.stringify(schema.const)}`);
  if (own(schema, 'enum') && !schema.enum.includes(value)) fail(`must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);

  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('must be an object');

      // `in` walks the prototype chain. The first version of this file used it,
      // so `{ constructor: "anything" }` satisfied additionalProperties:false
      // and `required: ["toString"]` was satisfied by {}. Own properties only.
      const present = Object.keys(value);

      for (const key of schema.required ?? []) {
        if (!own(value, key)) fail(`is missing required property "${key}"`);
      }
      if (schema.additionalProperties === false) {
        for (const key of present) {
          if (!own(schema.properties ?? {}, key)) fail(`has unexpected property "${key}"`);
        }
      }
      if (schema.minProperties !== undefined && present.length < schema.minProperties) fail(`must have at least ${schema.minProperties} properties`);
      if (schema.maxProperties !== undefined && present.length > schema.maxProperties) fail(`must have at most ${schema.maxProperties} properties`);

      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (own(value, key)) measure(sub, value[key], `${path}.${key}`);
      }
      return value;
    }

    case 'array': {
      if (!Array.isArray(value)) fail('must be an array');
      if (schema.minItems !== undefined && value.length < schema.minItems) fail(`must have at least ${schema.minItems} items`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`must have at most ${schema.maxItems} items`);
      if (schema.uniqueItems === true) {
        const seen = new Set(value.map((item) => JSON.stringify(item)));
        if (seen.size !== value.length) fail('must not contain duplicate items');
      }
      value.forEach((item, i) => measure(schema.items ?? {}, item, `${path}[${i}]`));
      return value;
    }

    case 'string': {
      if (typeof value !== 'string') fail('must be a string');
      if (schema.minLength !== undefined && value.length < schema.minLength) fail(`must be at least ${schema.minLength} characters`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(`must be at most ${schema.maxLength} characters`);
      if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) fail('does not match the required pattern');
      return value;
    }

    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('must be a finite number');
      if (schema.type === 'integer' && !Number.isInteger(value)) fail('must be an integer');
      if (schema.minimum !== undefined && value < schema.minimum) fail(`must be at least ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) fail(`must be at most ${schema.maximum}`);
      if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail(`must be greater than ${schema.exclusiveMinimum}`);
      if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) fail(`must be less than ${schema.exclusiveMaximum}`);
      if (schema.multipleOf !== undefined) {
        const quotient = value / schema.multipleOf;
        if (!Number.isInteger(Number(quotient.toFixed(9)))) fail(`must be a multiple of ${schema.multipleOf}`);
      }
      return value;
    }

    case 'boolean':
      if (typeof value !== 'boolean') fail('must be a boolean');
      return value;

    case 'null':
      if (value !== null) fail('must be null');
      return value;

    default:
      // Unreachable once assertSchema has run. Left as a throw rather than a
      // pass so that it cannot become the silent branch again.
      throw new SchemaError(`${path} schema has unknown type "${String(schema.type)}"`);
  }
}

export function createRegistry() {
  const tools = new Map();

  return {
    register(name, { schema, handler, confirm = false } = {}) {
      if (typeof name !== 'string' || name.length === 0) throw new SchemaError('a tool needs a name');
      if (typeof handler !== 'function') throw new SchemaError(`handler for ${name} must be a function`);
      if (schema === undefined) throw new SchemaError(`tool ${name} has no schema; pass {} to accept anything, deliberately`);
      assertSchema(schema, `tool ${name} schema`);
      tools.set(name, { schema, handler, confirm });
      return this;
    },

    /** The tool list to send with the request. Derived from the registry, so a
     *  tool that is advertised is by construction a tool that exists. */
    definitions() {
      return [...tools.entries()].map(([name, { schema }]) => ({
        type: 'function',
        function: { name, parameters: schema },
      }));
    },

    names() {
      return [...tools.keys()];
    },

    /**
     * Run one tool call from a model response.
     *
     * @param call    { name, arguments } as returned by the provider
     * @param context the caller's own authority: who is signed in, what they
     *                may touch. Never taken from the model.
     */
    async run(call, context = {}) {
      const name = call?.name;
      // A Map rather than a plain object, so that a tool named "constructor"
      // or "__proto__" cannot resolve to something nobody registered.
      const tool = tools.get(name);
      // An unregistered name is not an error to report back for correction. It
      // is the model asking for something that does not exist, which on a bad
      // day is the model having been told to ask for it.
      if (!tool) throw new ToolError(`unknown tool "${String(name)}"`, { code: 'unknown_tool' });

      let args;
      try {
        args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
      } catch {
        throw new ToolError('arguments were not valid JSON', { code: 'invalid_arguments' });
      }

      // strict:false because the schema was checked at registration. Checking
      // it again on every call would make a hot path walk a structure that
      // cannot have changed.
      validate(tool.schema, args, 'arguments', { strict: false });

      // Anything with a consequence a person would want to be asked about is
      // returned for confirmation rather than executed. The model proposes; a
      // human, or an explicit policy, disposes.
      if (tool.confirm && !context.confirmed) {
        return { status: 'needs_confirmation', name, arguments: args };
      }

      const result = await tool.handler(args, context);
      return { status: 'ok', name, result };
    },
  };
}
