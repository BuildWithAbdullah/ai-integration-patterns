/**
 * catalogue.mjs
 *
 * Every failure mode this repository has a position on, in one list.
 *
 * Two kinds, and the distinction is the point of the file.
 *
 *   rejected   The code refuses it and says why. `test/catalogue.test.mjs`
 *              drives every one of these out of a real call against a real
 *              module and asserts set equality in both directions, so an id
 *              listed here that nothing can produce fails the build, and an
 *              error a module can produce that is not listed here fails it too.
 *
 *   prevented  The code avoids it rather than reporting it, so there is no
 *              error to catch. Each one has a pair under `pairs/`, where a
 *              naive implementation exhibits it and the shipped one does not.
 *              A claim to prevent something, with nothing demonstrating the
 *              something, is the failure mode this whole repository is
 *              arguing against.
 *
 * Before this file existed, six of the modules' error paths had never been
 * observed to fire in a test, and four defects were sitting in them.
 */

export const FINDINGS = [
  // ---------------------------------------------------------------- schema
  { id: 'schema.missing', kind: 'rejected', module: 'tools', summary: 'a tool was registered with no schema at all' },
  { id: 'schema.nameless-tool', kind: 'rejected', module: 'tools', summary: 'a tool was registered without a name' },
  { id: 'schema.handler-not-a-function', kind: 'rejected', module: 'tools', summary: 'a tool was registered with something other than a function as its handler' },
  { id: 'schema.not-an-object', kind: 'rejected', module: 'tools', summary: 'a schema is a string, an array or null rather than an object' },
  { id: 'schema.unknown-type', kind: 'rejected', module: 'tools', summary: 'a schema names a type this validator cannot enforce, usually a typo' },
  { id: 'schema.unenforced-keyword', kind: 'rejected', module: 'tools', summary: 'a schema carries a keyword this validator does not enforce, which would otherwise be ignored in silence' },
  { id: 'schema.untyped-but-constrained', kind: 'rejected', module: 'tools', summary: 'a schema has constraints but no type, so none of them would apply' },
  { id: 'schema.unsatisfiable-required', kind: 'rejected', module: 'tools', summary: 'a schema requires a property it does not declare while forbidding additional properties' },

  // ------------------------------------------------------------- arguments
  { id: 'args.not-an-object', kind: 'rejected', module: 'tools', summary: 'arguments were an array, null or a scalar where an object was declared' },
  { id: 'args.missing-required', kind: 'rejected', module: 'tools', summary: 'a required property is absent' },
  { id: 'args.unexpected-property', kind: 'rejected', module: 'tools', summary: 'a property that is not in the schema arrived under additionalProperties:false' },
  { id: 'args.too-few-properties', kind: 'rejected', module: 'tools', summary: 'fewer properties than minProperties' },
  { id: 'args.too-many-properties', kind: 'rejected', module: 'tools', summary: 'more properties than maxProperties' },
  { id: 'args.not-an-array', kind: 'rejected', module: 'tools', summary: 'a scalar or object where an array was declared' },
  { id: 'args.too-few-items', kind: 'rejected', module: 'tools', summary: 'fewer items than minItems' },
  { id: 'args.too-many-items', kind: 'rejected', module: 'tools', summary: 'more items than maxItems' },
  { id: 'args.duplicate-items', kind: 'rejected', module: 'tools', summary: 'repeated items under uniqueItems' },
  { id: 'args.not-a-string', kind: 'rejected', module: 'tools', summary: 'a number or object where a string was declared' },
  { id: 'args.too-short', kind: 'rejected', module: 'tools', summary: 'a string shorter than minLength' },
  { id: 'args.too-long', kind: 'rejected', module: 'tools', summary: 'a string longer than maxLength' },
  { id: 'args.pattern-mismatch', kind: 'rejected', module: 'tools', summary: 'a string that does not match the declared pattern' },
  { id: 'args.not-a-number', kind: 'rejected', module: 'tools', summary: 'a non-number, or NaN or Infinity, where a number was declared' },
  { id: 'args.not-an-integer', kind: 'rejected', module: 'tools', summary: 'a fractional value where an integer was declared' },
  { id: 'args.below-minimum', kind: 'rejected', module: 'tools', summary: 'a number below minimum' },
  { id: 'args.above-maximum', kind: 'rejected', module: 'tools', summary: 'a number above maximum' },
  { id: 'args.not-above-exclusive-minimum', kind: 'rejected', module: 'tools', summary: 'a number equal to or below exclusiveMinimum' },
  { id: 'args.not-below-exclusive-maximum', kind: 'rejected', module: 'tools', summary: 'a number equal to or above exclusiveMaximum' },
  { id: 'args.not-a-multiple', kind: 'rejected', module: 'tools', summary: 'a number that is not a multiple of multipleOf' },
  { id: 'args.not-a-boolean', kind: 'rejected', module: 'tools', summary: 'a truthy string or number where a boolean was declared' },
  { id: 'args.not-null', kind: 'rejected', module: 'tools', summary: 'a value other than null where null was declared' },
  { id: 'args.not-in-enum', kind: 'rejected', module: 'tools', summary: 'a value outside the declared enum' },
  { id: 'args.not-the-const', kind: 'rejected', module: 'tools', summary: 'a value other than the declared const' },

  // ------------------------------------------------------------- tool call
  { id: 'tool.unknown-name', kind: 'rejected', module: 'tools', summary: 'the model asked for a tool that was never registered' },
  { id: 'tool.arguments-not-json', kind: 'rejected', module: 'tools', summary: 'the arguments string the provider returned is not parseable JSON' },

  // ---------------------------------------------------------------- budget
  { id: 'budget.request-over-ceiling', kind: 'rejected', module: 'budget', summary: 'one request estimates larger than the per-request ceiling' },
  { id: 'budget.window-exhausted', kind: 'rejected', module: 'budget', summary: 'the identity has no budget left in the current window' },
  { id: 'budget.unknown-receipt', kind: 'rejected', module: 'budget', summary: 'a reservation was settled twice, or after it aged out of the window' },

  // ------------------------------------------------------------- transport
  { id: 'transport.transient-status', kind: 'rejected', module: 'client', summary: 'the provider returned a status worth retrying and every attempt was spent' },
  { id: 'transport.permanent-status', kind: 'rejected', module: 'client', summary: 'the provider returned a status that will fail identically forever' },
  { id: 'transport.retry-after-too-long', kind: 'rejected', module: 'client', summary: 'the provider asked for a longer wait than this client will hold a request open for' },
  { id: 'transport.deadline-before-attempt', kind: 'rejected', module: 'client', summary: 'the overall deadline passed before an attempt could be made' },
  { id: 'transport.deadline-before-retry', kind: 'rejected', module: 'client', summary: 'the next backoff would land after the overall deadline' },

  // ------------------------------------------------------------ structured
  { id: 'structured.no-json', kind: 'rejected', module: 'structured', summary: 'the response contains no object and no array' },
  { id: 'structured.malformed-json', kind: 'rejected', module: 'structured', summary: 'a balanced value was found and it is not valid JSON' },
  { id: 'structured.truncated', kind: 'rejected', module: 'structured', summary: 'the value was never closed, so the response hit the token limit' },
  { id: 'structured.unusable-after-repair', kind: 'rejected', module: 'structured', summary: 'the repair attempt was spent and the result still does not validate' },

  // ------------------------------------------------------------- prevented
  { id: 'prevented.chunk-boundary-split', kind: 'prevented', module: 'stream', pair: '01', summary: 'an event split across two reads is parsed as two broken events' },
  { id: 'prevented.prototype-key-accepted', kind: 'prevented', module: 'tools', pair: '02', summary: 'a property inherited from Object.prototype satisfies required, or slips past additionalProperties:false' },
  { id: 'prevented.unenforced-constraint', kind: 'prevented', module: 'tools', pair: '03', summary: 'a constraint the validator does not implement is ignored rather than refused' },
  { id: 'prevented.unbounded-retry-after', kind: 'prevented', module: 'client', pair: '04', summary: 'the provider parks a request handler for as long as it likes' },
  { id: 'prevented.unreserved-budget', kind: 'prevented', module: 'budget', pair: '05', summary: 'concurrent requests for one identity all measure against the same stale total' },
  { id: 'prevented.abort-ignored-while-idle', kind: 'prevented', module: 'stream', pair: '06', summary: 'an abort is only noticed when the next event arrives, so a quiet stream cannot be cancelled' },
  { id: 'prevented.unredacted-context', kind: 'prevented', module: 'boundary', pair: '07', summary: 'redaction exists, is documented, and is never called' },
  { id: 'prevented.repair-on-truncation', kind: 'prevented', module: 'structured', pair: '08', summary: 'a truncated response is sent back for repair, which buys the same truncation twice' },
  { id: 'prevented.array-root-rejected', kind: 'prevented', module: 'structured', pair: '09', summary: 'a response whose root is an array is reported as containing no JSON' },
  { id: 'prevented.identity-map-leak', kind: 'prevented', module: 'budget', pair: '10', summary: 'an identity key is retained for every address ever seen' },

  // -------------------------------------------------------------- residual
  //
  // What the fixes do not clear. Each one is observed on the FIXED side of a
  // pair and asserted there, in both directions: if a change ever made one of
  // these go away the build fails and this list is wrong, and if one appears
  // in a pair that does not declare it the build fails too.
  //
  // A repository that states its limits in a paragraph and one that states
  // them in an assertion are not making the same claim.
  { id: 'residual.injection-within-authority', kind: 'residual', module: 'tools', pair: '02', summary: 'a forged property name is refused; an injected instruction calling a real tool with valid arguments is not, which is why the handler runs with the caller authority and not the model request' },
  { id: 'residual.format-not-enforced', kind: 'residual', module: 'tools', pair: '03', summary: 'semantic constraints such as format:email are refused at registration rather than enforced at validation, so the handler still has to check them' },
  { id: 'residual.work-still-not-done', kind: 'residual', module: 'client', pair: '04', summary: 'handing a long Retry-After back to the caller frees the worker and does not answer the user; something upstream still has to queue the work or shed it' },
  { id: 'residual.redaction-misses-unlisted-formats', kind: 'residual', module: 'boundary', pair: '07', summary: 'redaction catches four shapes and nothing else, so an IBAN, a sort code, a passport number or a national identifier that is not a US one goes through untouched' },
  { id: 'residual.provider-bills-until-hangup', kind: 'residual', module: 'stream', pair: '06', summary: 'cancelling the body stops this process reading; whether the provider stops generating and stops charging for it is the provider decision and cannot be asserted from here' },
];

export const ids = () => FINDINGS.map((f) => f.id);
export const byKind = (kind) => FINDINGS.filter((f) => f.kind === kind).map((f) => f.id);
export const find = (id) => FINDINGS.find((f) => f.id === id);
