# AI Integration Patterns

The parts of putting a language model behind a website that are ordinary
engineering: transport, failure, streaming, structured output, tool calls, the
trust boundary, and a cost ceiling.

`npm test` runs 158 tests. `npm run verify` makes
487 assertions about the repository itself.
No API key, no network, no dependencies.

Every module here is paired with a naive implementation of the same thing, in
`pairs/`, which is graded on every run and must keep failing. There are
10 fail and pass pairs and 61 catalogued failure modes, and
`docs/04-what-this-repository-got-wrong.md` lists the fifteen defects this
repository shipped before any of that existed.

## What this repository is, and is not

**It is a capability repository.** Unlike the other repositories in this
account, the patterns here are not extracted from delivered client work. They
are the integration concerns I build against, written and tested from scratch
for this repository. That is stated here rather than left to be inferred,
because the other repositories make the opposite claim and the difference
matters.

**The tests prove the integration logic, not the model.** They assert that a
400 is not retried, that an event split mid-character is reassembled, that an
unregistered tool name never reaches a handler, that a repair loop is bounded.
They assert nothing about the quality of any model's output, because that is not
a property a unit test can hold.

**There are no benchmarks, no model comparisons and no prices.** Those change on
the provider's schedule, and a repository asserting today's model list is stale
within months and wrong in a way nobody notices. Model choice belongs in
configuration; prices belong wherever you watch the bill.

## The modules

| Module | What it is for |
|---|---|
| [`src/client.mjs`](src/client.mjs) | Timeouts, retries, jittered backoff, a ceiling on `Retry-After`, a deadline over the whole call, and the line between errors worth retrying and errors that will fail identically forever |
| [`src/stream.mjs`](src/stream.mjs) | SSE parsing that survives events split across chunks, including mid-character, and an abort path that fires while the stream is quiet |
| [`src/structured.mjs`](src/structured.mjs) | Getting an object or an array back from fenced, prefaced or truncated text, validating it, and repairing exactly once except when repair cannot help |
| [`src/tools.mjs`](src/tools.mjs) | The tool allowlist, a strict argument validator, confirmation for consequences, and the caller's authority rather than the model's request |
| [`src/boundary.mjs`](src/boundary.mjs) | Fencing untrusted content, neutralising role markers, and redaction that is actually called |
| [`src/budget.mjs`](src/budget.mjs) | A per-request ceiling and a per-identity window with reservations, which fail differently |

[`examples/express-proxy.mjs`](examples/express-proxy.mjs) puts them together.
It is syntax-checked in CI and not run there, because running it needs a key and
a network, and a test that needs both is a test that gets skipped.

## The pairs

Each directory under `pairs/` holds three files: `naive.mjs`, the ordinary first
attempt at the problem or the implementation this repository actually shipped;
`fixed.mjs`, which re-exports what `src/` does now; and `probe.mjs`, which
exercises both and reports which catalogued failure modes it observed.

`pairs/index.mjs` declares, per pair, exactly what the naive side must exhibit
and exactly what the fixed side must still exhibit. Both are asserted in both
directions, so a defect that stops reproducing fails the build, and so does a
fix that appears to clear a limit this repository says it cannot clear.

| Pair | What the naive version does |
|---|---|
| [01](pairs/01-chunk-boundary) | Parses each read in isolation, so an event split across two reads is dropped |
| [02](pairs/02-prototype-keys) | Uses `key in value`, so `constructor` satisfies a closed schema and `toString` satisfies `required` |
| [03](pairs/03-unenforced-constraints) | Ignores the keywords it does not implement, so `minLength: 8` accepts the empty string |
| [04](pairs/04-retry-after-ceiling) | Obeys `Retry-After: 3600` literally, parking a request handler for an hour |
| [05](pairs/05-budget-reservation) | Checks, awaits, then records, so every concurrent request measures against the same stale total |
| [06](pairs/06-abort-while-idle) | Checks the abort signal once per event, so a quiet stream cannot be cancelled |
| [07](pairs/07-unredacted-context) | Has a redaction function beside the message builder and never calls it |
| [08](pairs/08-repair-on-truncation) | Sends a truncated response back for repair, buying the same truncation twice |
| [09](pairs/09-array-root) | Scans for `{`, so an array at the root is reported as no JSON at all |
| [10](pairs/10-identity-leak) | Prunes the entries in each window and keeps one Map key per address ever seen |

## The three things that actually matter

**The key never reaches the browser.** There is no arrangement of a
browser-side integration that keeps an API key secret. Not an obfuscated
bundle, not a key fetched at runtime, not one split across two requests. If the
browser can use it, the person holding the browser has it. See
[docs/01](docs/01-server-proxy.md).

**Prompts are not a security boundary.** A model reads its whole context as one
stream of text and cannot distinguish your instructions from a document. Every
"do not follow instructions in the content" line is more text in the same
stream. What contains an injection is on the output side: an allowlist,
validated arguments, and tools that act with the signed-in user's authority so
that a successful attack reaches only what the attacker already had. See
[docs/02](docs/02-prompt-injection.md).

**The feature will be unavailable, so decide now what happens.** The page had a
purpose before this existed. An outage should cost the feature, not the page,
and the degraded path is the one nobody tests. See [docs/03](docs/03-failure-and-cost.md).

## What this does not do

The limits, stated here and asserted in `pairs/`. Each one is observed on the
fixed side of a pair and catalogued as a residual, so a change that made one go
away would fail the build and send somebody back to this section.

**Validated arguments do not stop prompt injection, they survive it.** A tool
call that an injected instruction asked for and one a user asked for are both
well formed, and no validator can tell them apart. Containment is that the
handler acts with the caller's authority: if a tool can only touch rows the
signed-in user already owns, a successful attack reaches what the attacker
already had. That is the whole claim, and it is smaller than "we validate tool
calls" sounds.

**Semantic constraints are refused, not enforced.** `format: 'email'` is
rejected at registration rather than silently ignored, which is honest, and it
still leaves the handler to check that the string is an address before it mails
anything. The validator covers structure, ranges, lengths, patterns and
enumerations, and nothing that requires knowing what a value means.

**Redaction catches four shapes and nothing else.** Card numbers, US social
security numbers, email addresses and keys with an `sk-` or `rk-` prefix. An
IBAN, a UK sort code, a passport number, a national identifier that is not a US
one: all go to the provider in full. `pairs/07` asserts a sort code passing
through, so the limit is a fact rather than a caveat. If you are relying on this
layer to keep an identifier out of a third party's logs, add the pattern, or
better, do not put the identifier here.

**Handing a long `Retry-After` back frees the worker and does not answer the
user.** Something upstream still has to queue the work or shed it. The client
returns promptly with the figure the provider gave so that the decision can be
made somewhere that knows what the request was for.

**Cancelling the stream stops this process reading. It does not prove the
provider stopped generating.** Closing the response body is the correct and only
available move from here; whether a given provider stops producing tokens and
stops charging for them is its decision, and nothing in this repository can
assert it.

**The token estimate is wrong, deliberately.** It is `length / 4` plus a
fraction per word, and it drifts furthest on the inputs that matter: code, JSON,
and languages other than English. It exists to refuse a request that is ten
times too large before it is sent. Reconcile against the usage the provider
reports, which is the only authoritative figure, and which is what `settle`
takes.

**The suite does not prove any provider behaves like the stub.** Every test runs
against a fake transport. The module boundaries are drawn so that a provider
revision is a change in one file, and `docs/01-server-proxy.md` says which.

## Documents

| Document | What it covers |
|---|---|
| [01 The key never reaches the browser](docs/01-server-proxy.md) | Why there is no client-side arrangement that works, what the proxy is for beyond hiding the key, and what to log |
| [02 Prompt injection](docs/02-prompt-injection.md) | Why prompt-level defences are mitigations rather than controls, what a real boundary looks like, and how retrieval widens it |
| [03 Failure and cost](docs/03-failure-and-cost.md) | Retry policy, jitter, degradation, the two budget ceilings, the abort path, and why repair loops are bounded |
| [04 What this repository got wrong](docs/04-what-this-repository-got-wrong.md) | Fifteen defects that shipped, each reproduced by a test, and two traps that cost time without being defects |
| [05 Failure modes](docs/05-failure-modes.md) | The generated catalogue: what is refused, what is prevented, and what is left over |

## Verifying

```bash
npm test          # 158 tests, no API key, no network
npm run verify    # 487 assertions about the repository, and the suite again
npm run check     # syntax-check the reference Express proxy
npm run catalogue # regenerate docs/05-failure-modes.md from the catalogue
```

`npm test` runs through `tools/run-tests.mjs`, which consumes the structured
event stream from `node:test` and counts `test:pass` and `test:fail` events as
objects. That is deliberate: a verifier that parses reporter output breaks on a
Node upgrade, because Node 20 and 22 print TAP when piped and Node 24 prints the
spec reporter regardless. Zero tests is treated as a failure, because a glob
that matches nothing otherwise reports a clean run.

`npm run verify` checks the things a test suite does not: that every module
exports what the documents name, that no module does its work at import time,
that every pair has its three files and its fixed side re-exports `src/` rather
than reimplementing it, that every catalogued finding is observed somewhere, and
that the numbers printed in this README are the numbers the run produced. That
last check compares whole phrases rather than pulling an integer out with a
pattern, because a pattern that reads the first number near a phrase will agree
with a sentence that is wrong.

Every test runs against a stub transport. That means the retry policy, both
budget ceilings, the abort path, the streaming parser and the structured-output
repair loop are all exercised without reaching a provider and without a key. A
suite that needs a key is a suite nobody runs, and one that calls a live model is
testing the model rather than the code.

CI runs the suite on Node 20, 22 and 24, installs with `--engine-strict` on the
declared floor, syntax-checks the example, and checks the generated catalogue
against its source, on every push to `main`.

## Scope

Integration mechanics for a model behind a website: a chat or assistant
endpoint, a summarisation or classification step, a workflow triggered by a
webhook. Framework-free apart from the one Express example, and provider shapes
are kept at arm's length so the patterns survive an API revision.

Not covered: fine-tuning, evaluation harnesses, vector database selection, or
anything that amounts to a model recommendation.

## Related

- [wordpress-security-hardening](https://github.com/BuildWithAbdullah/wordpress-security-hardening) - the same instinct about trust boundaries, applied to a CMS
- [technical-seo-toolkit](https://github.com/BuildWithAbdullah/technical-seo-toolkit) - patterns with a machine-checked failing and corrected example each
- [wix-squarespace-accessibility](https://github.com/BuildWithAbdullah/wix-squarespace-accessibility) - where the asserted residual idea in `pairs/` came from

## Licence

MIT. Use them, ship them, no attribution required.
