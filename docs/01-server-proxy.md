# The key never reaches the browser

There is no arrangement of a browser-side integration that keeps an API key
secret. Not an obfuscated bundle, not a key fetched at runtime, not one
assembled from two requests, not one in an environment variable that a build
step inlines. If the browser can use the key, the person holding the browser
has it.

This is worth stating plainly because it is the most common serious mistake in
this area, it is easy to make with a framework that blurs the client and server
boundary, and the feedback loop is an invoice weeks later.

Two rules follow from it:

- The key is read from the environment, in server code, and never sent
  anywhere except in an `Authorization` header to the provider.
- Any environment variable naming convention that exposes values to the client
  bundle is the wrong place for it. Frameworks differ on the prefix; the
  question to ask is always which of these variables end up in the browser.

## What the proxy is for beyond hiding the key

If the proxy only forwarded requests, it would be an open, unauthenticated,
unmetered endpoint to a paid API, which is worse than the key being public
because it is harder to notice. The proxy exists to apply the things a browser
cannot be trusted to apply:

**Identity.** Taken from the session, never from the request body. A budget
keyed on a value the caller supplies is a budget the caller can reset by
changing it.

**A budget.** Both ceilings from [`../src/budget.mjs`](../src/budget.mjs): one
per request, one per identity per window. They fail differently and you need
both.

**Input limits.** A body size limit and a truncation on the prompt. Without
them, the largest request anyone can send is the largest request your platform
accepts.

**The abort path.** A listener on the response close that aborts the upstream
request. Without it, a user who closes the tab leaves generation running and
billing until it finishes by itself. This is invisible in development, where
nobody closes the tab, and it is a meaningful share of the bill on a real site.

**Error containment.** Never pass the upstream error body back to the client.
It can contain the request, and the request can contain a customer's data.

## What to log, and what not to

Log the identity, token counts, latency, model, and the outcome. Those are what
you need when the bill or the latency moves.

Do not log the prompts and completions by default. On any site with real users
those contain whatever people typed, which is names, addresses, order details
and occasionally a password. That is a data retention decision and a privacy
notice question, not a debugging convenience, and it should be an explicit
choice with a retention period rather than something that happened because the
logger was set to debug.
