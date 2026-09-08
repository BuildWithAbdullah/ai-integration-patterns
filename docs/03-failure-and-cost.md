# Failure and cost

Two topics in one document because they are the same topic seen from two
angles: what happens when the request does not go as planned, and who pays for
it.

## The request will fail

Not might. A third-party HTTP call under load fails at some rate, and language
model APIs fail more than most because they are slower, they are rate limited
per organisation, and demand is spiky.

**Retry the transient, never the permanent.** 429 and 5xx are worth trying
again. 400 and 422 mean the request is wrong and will be wrong next time. 401
and 403 mean the credential is wrong. Retrying those is a slower way to receive
the same answer, and on a 429 it actively makes things worse.

**Honour Retry-After.** When the provider tells you how long to wait, waiting
less is how a rate limit becomes a block.

**Jitter the backoff.** Fixed backoff synchronises every client that failed at
the same moment into retrying at the same moment. A provider blip becomes a
self-inflicted stampede. Full jitter, a random point in the window rather than
the window itself, is the version that works, and
[`../test/client.test.mjs`](../test/client.test.mjs) asserts the spread rather
than trusting the comment.

**Always set a timeout.** A request with no timeout can hang for as long as the
socket stays open. On a serverless platform you pay for the whole hang.

## The feature will be unavailable

Eventually the provider will be down and no retry policy will help. The page had
a purpose before the feature existed, and an outage should cost the feature,
not the page.

Decide in advance what happens: fall back to search, to a contact form, to a
static help article, to the plain product page. Then make sure the failure path
is one a user can act on, rather than a spinner that never resolves. The
degraded path is the one nobody tests, so it is worth being the one thing you
do test manually before launch.

## Who pays

**A per-request ceiling** stops one pathological request: a large document
pasted into a summariser, or a retrieval step that matched more than it should
and stuffed the context.

**A per-identity window** stops a loop: a script hammering the endpoint, or one
user who found the feature entertaining. A per-request cap does nothing about
ten thousand individually reasonable requests, which is why there are two
controls and not one.

**The abort path** is the one people miss entirely. Streaming makes a feature
feel fast and it also means the expensive part continues after the user has
stopped caring. Without an abort, every abandoned request is generated and paid
for in full.

## Estimating tokens

[`../src/budget.mjs`](../src/budget.mjs) includes a rough estimator and says
plainly that it is wrong. Real tokenisation depends on the model's vocabulary,
and the approximation drifts furthest on exactly the inputs that matter: code,
JSON, and languages other than English.

It is a pre-flight check to catch the request that is ten times too big before
it is sent. The authoritative number is the usage the provider returns, and
that is what gets recorded. Anything billed on an estimate is billed wrongly.

## Repair loops are a cost decision

When a structured response fails validation, one repair attempt is reasonable.
Unbounded repair turns a request that was going to fail into a request that
fails slowly and costs several times as much, and the attempt that eventually
succeeds is often the one that quietly dropped a field.

Truncation deserves separate handling, which is why
[`../src/structured.mjs`](../src/structured.mjs) reports it distinctly.
Truncation is not a comprehension failure; asking again with the same token
budget produces the same truncation slightly further along. Raise the limit or
shorten the input.

## Model names and prices are not in this repository

Deliberately. Both change on the provider's schedule, and a source file
asserting today's model list or today's rate is stale within months and wrong
in a way that is hard to notice.

Model choice belongs in configuration you can change without a deploy. Prices
belong in whatever you use to watch the bill.
