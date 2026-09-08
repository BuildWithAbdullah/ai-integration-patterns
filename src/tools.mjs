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
 */

export class ToolError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

/**
 * A small structural validator. It is here rather than as a dependency because
 * the rules worth enforcing on a tool call are few and the cost of a schema
 * library on the trust boundary is a supply chain you did not audit.
 */
export function validate(schema, value, path = 'arguments') {
  const fail = (msg) => { throw new ToolError(`${path} ${msg}`, { code: 'invalid_arguments' }); };

  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('must be an object');
    for (const key of schema.required ?? []) {
      if (!(key in value)) fail(`is missing required property "${key}"`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in (schema.properties ?? {}))) fail(`has unexpected property "${key}"`);
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) validate(sub, value[key], `${path}.${key}`);
    }
    return value;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('must be an array');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`must have at most ${schema.maxItems} items`);
    value.forEach((item, i) => validate(schema.items ?? {}, item, `${path}[${i}]`));
    return value;
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') fail('must be a string');
    if (schema.enum && !schema.enum.includes(value)) fail(`must be one of ${schema.enum.join(', ')}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(`must be at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail('does not match the required pattern');
    return value;
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || Number.isNaN(value)) fail('must be a number');
    if (schema.type === 'integer' && !Number.isInteger(value)) fail('must be an integer');
    if (schema.minimum !== undefined && value < schema.minimum) fail(`must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`must be at most ${schema.maximum}`);
    return value;
  }

  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') fail('must be a boolean');
    return value;
  }

  return value;
}

export function createRegistry() {
  const tools = new Map();

  return {
    register(name, { schema, handler, confirm = false }) {
      if (typeof handler !== 'function') throw new Error(`handler for ${name} must be a function`);
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

    /**
     * Run one tool call from a model response.
     *
     * @param call    { name, arguments } as returned by the provider
     * @param context the caller's own authority: who is signed in, what they
     *                may touch. Never taken from the model.
     */
    async run(call, context = {}) {
      const tool = tools.get(call.name);
      // An unregistered name is not an error to report back for correction. It
      // is the model asking for something that does not exist, which on a bad
      // day is the model having been told to ask for it.
      if (!tool) throw new ToolError(`unknown tool "${call.name}"`, { code: 'unknown_tool' });

      let args;
      try {
        args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
      } catch {
        throw new ToolError('arguments were not valid JSON', { code: 'invalid_arguments' });
      }

      validate(tool.schema, args);

      // Anything with a consequence a person would want to be asked about is
      // returned for confirmation rather than executed. The model proposes; a
      // human, or an explicit policy, disposes.
      if (tool.confirm && !context.confirmed) {
        return { status: 'needs_confirmation', name: call.name, arguments: args };
      }

      const result = await tool.handler(args, context);
      return { status: 'ok', name: call.name, result };
    },
  };
}
