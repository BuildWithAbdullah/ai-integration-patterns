# AI Integration Patterns

The parts of putting a language model behind a website that are ordinary
engineering: transport, failure, streaming, structured output, tool calls, the
trust boundary, and a cost ceiling.

`npm test` runs 58 tests against a fake transport. No API key, no network, no
dependencies.

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
| [`src/client.mjs`](src/client.mjs) | Timeouts, retries, jittered backoff, `Retry-After`, and the line between errors worth retrying and errors that will fail identically forever |
| [`src/stream.mjs`](src/stream.mjs) | SSE parsing that survives events split across chunks, including mid-character, and an abort path so an abandoned response stops costing money |
| [`src/structured.mjs`](src/structured.mjs) | Getting an object back from fenced, prefaced or truncated text, validating it, and repairing exactly once |
| [`src/tools.mjs`](src/tools.mjs) | The tool allowlist, argument validation, confirmation for consequences, and the caller's authority rather than the model's request |
| [`src/boundary.mjs`](src/boundary.mjs) | Fencing untrusted content, neutralising role markers, and redaction on the way in |
| [`src/budget.mjs`](src/budget.mjs) | A per-request ceiling and a per-identity window, which fail differently |

[`examples/express-proxy.mjs`](examples/express-proxy.mjs) puts them together.
It is syntax-checked in CI and not run there, because running it needs a key and
a network, and a test that needs both is a test that gets skipped.

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

## Documents

| Document | What it covers |
|---|---|
| [01 The key never reaches the browser](docs/01-server-proxy.md) | Why there is no client-side arrangement that works, what the proxy is for beyond hiding the key, and what to log |
| [02 Prompt injection](docs/02-prompt-injection.md) | Why prompt-level defences are mitigations rather than controls, what a real boundary looks like, and how retrieval widens it |
| [03 Failure and cost](docs/03-failure-and-cost.md) | Retry policy, jitter, degradation, the two budget ceilings, the abort path, and why repair loops are bounded |

## Running it

```bash
npm test          # 58 tests, no key, no network
npm run check     # syntax-check the reference proxy
```

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

## Licence

MIT. Use them, ship them, no attribution required.
