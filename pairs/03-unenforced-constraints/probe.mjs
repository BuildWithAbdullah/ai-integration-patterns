const rejects = (impl, schema, value) => {
  try { impl.validate(schema, value); return false; } catch { return true; }
};

export async function probe(impl) {
  const observed = new Set();

  // Three constraints an author would reasonably believe were live, and a type
  // with a typo in it. Being ignored and being enforced are the only two
  // acceptable outcomes; being ignored in silence is not one of them.
  const ignored = [
    [{ type: 'string', minLength: 8 }, ''],
    [{ type: 'array', minItems: 2, items: { type: 'string' } }, []],
    [{ type: 'integer', minimum: 1 }, -5],
    [{ type: 'strng' }, { anything: true }],
  ].some(([schema, value]) => !rejects(impl, schema, value));

  if (ignored) observed.add('prevented.unenforced-constraint');

  // The residual, and it is a real limit rather than a hedge. `format` is
  // refused at registration, which is honest, and it is still not enforced:
  // the handler has to check that the string is an address before it mails it.
  const formatRefused = rejects(impl, { type: 'string', format: 'email' }, 'not-an-address');
  const formatEnforced = rejects(impl, { type: 'string' }, 'not-an-address');
  if (formatRefused && !formatEnforced) observed.add('residual.format-not-enforced');

  return observed;
}
