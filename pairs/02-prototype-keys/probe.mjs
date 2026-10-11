const STRICT = { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } }, required: ['id'] };

const rejects = (impl, schema, value) => {
  try { impl.validate(schema, value); return false; } catch { return true; }
};

export async function probe(impl) {
  const observed = new Set();

  // A property name inherited from Object.prototype must not satisfy a closed
  // schema, and must not satisfy `required` on an object that does not have it.
  const slipsThrough = ['constructor', 'toString', 'valueOf', 'hasOwnProperty']
    .some((key) => !rejects(impl, STRICT, { id: 'a', [key]: 'injected' }));
  const requiredFaked = !rejects(impl, { type: 'object', required: ['toString'] }, {});

  if (slipsThrough || requiredFaked) observed.add('prevented.prototype-key-accepted');

  // The residual. A validator cannot tell a legitimate call from one an
  // injected instruction asked for: both are well formed. Containment is that
  // the handler acts with the caller authority, not that the call looked odd.
  const wellFormedButHostile = { id: 'order-belonging-to-somebody-else' };
  if (!rejects(impl, STRICT, wellFormedButHostile)) observed.add('residual.injection-within-authority');

  return observed;
}
