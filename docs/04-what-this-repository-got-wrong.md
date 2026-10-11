# What this repository got wrong

Fifteen defects, found by writing a test that reproduced each one, every one of
which had already shipped. They are listed because the list is more useful than
any paragraph about care would be: a reader deciding whether to trust the code
learns more from the mistakes it is willing to name than from its claims.

Each one has a test in `test/defects.test.mjs` that fails against the code as
it was. Six also have a pair under `pairs/`, where a naive implementation
exhibits the defect and the shipped one does not, graded both ways.

## The two that mattered

**A validator on the trust boundary that accepted inherited property names.**
`key in value` is the obvious way to ask whether an object has a property, and
on a boundary it is wrong, because `in` walks the prototype chain. Every object
inherits `constructor`, `toString`, `valueOf` and `hasOwnProperty` from
`Object.prototype`. So `{ "id": "ord_1", "constructor": "anything" }` satisfied
a schema with `additionalProperties: false`, and `required: ["toString"]` was
satisfied by `{}`. A strict schema was not strict, and the one place in the
repository where strictness is the entire point was the place that had this.

**A validator that ignored the constraints it did not implement.** `maxLength`
was implemented and `minLength` was not, so `{ type: 'string', minLength: 8 }`
accepted the empty string without a word. `minItems` the same. A type with a
typo in it validated nothing at all and returned the value. This is worse than
not supporting a keyword, because the schema author reads their own schema and
believes the rule is live; the failure surfaces as a row in a database rather
than as an exception. Unenforceable keywords are now refused at registration,
which is the only honest option: enforce it, or say you will not.

## The one that was the most embarrassing

**An abort path that could only fire when the thing it was cancelling
happened.** `textDeltas` checked `signal.aborted` once per iteration of a
`for await`, which means it checked when an event arrived. The case that
matters is the opposite one: the tab is closed, no events are coming, and the
loop is parked on a read. The module's own comment says that without an abort
path, every abandoned request on the site keeps generating tokens nobody will
read, and that it is invisible until the invoice. The abort path read as though
it prevented that and could not.

Worse, the first attempt at the fix reintroduced it in a new place, by awaiting
`iterator.return()`. `return()` on an async generator parked on an `await` does
not settle until that await finishes, so cancelling the stall waited for the
stall. `pairs/06` caught both versions, which is the argument for pairs in one
sentence.

## The rest

**Redaction that was written, exported, documented, and never called.**
`redact` worked. Nothing invoked it. `buildMessages` assembled the request
without it, under a doc comment describing redaction on the way in. A reviewer
reading the module sees a redaction function and moves on. The card number went
to the provider.

**A budget ceiling with nothing reserved against it.** `check` measured, the
caller awaited the request, `record` ran afterwards. In between, the recorded
total had not moved, so every concurrent request for one identity measured
against the same stale figure and all of them passed. A ceiling of 1000 tokens
admitted three requests of 805. Not a loose ceiling: no ceiling, as long as the
requests arrived together.

**One retained Map key per address ever seen.** The window pruned the entries
inside each identity and never removed the identity. Keyed on a client address
on a public endpoint, in a process meant to stay up for weeks, that is an
unbounded leak, and nothing in the code looks like one.

**`Retry-After` obeyed with no ceiling.** "Back off at least as long as the
provider asked" is right, and it is not the same as "wait as long as you are
told". `Retry-After: 3600` is a value real providers send during an incident,
and the client slept for an hour inside a request handler: one worker gone, one
socket held, one user watching a spinner until something else timed out. The
figure is now handed back to the caller, with a ceiling on what will be slept
through.

**A blank `Retry-After` read as "retry immediately".** `Number('')` is 0 and
`Number(' ')` is 0, so a header present but empty produced a zero wait and a
hot retry loop against a provider that was already rate limiting.

**A per-attempt timeout presented as a timeout.** `timeoutMs: 30000` with three
retries is a two minute worst case before backoff is counted. There is now a
deadline over the whole call.

**A truncated response sent back for repair.** `structured.mjs` opens by
explaining that truncation is a budget failure rather than a comprehension
failure, and that asking again with the same budget buys the same truncation
slightly further along. The code treated every structured error as repairable,
truncation included, so the single failure the module singles out as not worth
a second attempt was the one it spent a second attempt on.

**An array at the root reported as no JSON at all.** The extractor scanned for
`{`. "Here are the tags you asked for: [...]" came back as "no JSON object in
response", which sends the reader looking for a prompt problem that is not
there.

**Content blocks estimated by stringifying them.** `String()` on an array of
message blocks gives `[object Object]`, which the estimator priced at eleven
tokens, so a pre-flight check waved through a twenty thousand word document.
Estimating low is the dangerous direction, because refusing before sending is
the only thing the estimate is for.

**A tool registerable with no schema.** `validate(undefined, args)` threw a
`TypeError` from inside the validator on the first call that exercised it,
rather than a clear failure at startup.

**A role marker stripped from one line and not the next.** `\s` matches a
newline, so `^\s*` at a line start could swallow the blank line between two
markers and replace only the first.

**Whitespace trimmed from every data line in the event stream.** The format
strips one optional leading space and nothing else. The payload here is JSON so
nothing broke, and a provider streaming indented text would have had its
indentation eaten.

## Two traps that are not defects in this code, and cost time anyway

**The verifier failed on its own source.** The rule forbidding two dash
characters is enforced over every text file including the file enforcing it, so
writing the characters out as literals made the check fail on itself. They are
assembled from code points.

**A module that did its work at import time.** Importing a file that runs on
import means a test that imports it runs it, and in one case a generator wrote
the artefact that the verifier was about to certify. Everything that is also a
command now guards on `process.argv[1]`, and `tools/verify.mjs` asserts it.
