/**
 * handler.mjs
 *
 * The request handler from the reference proxy, with its dependencies passed
 * in so that it can be driven by a test rather than only read.
 *
 * It is separated from `express-proxy.mjs` for one reason. That file imports
 * express, so CI could only ever syntax-check it, and a syntax check does not
 * notice a call to a method that no longer exists. When `budget.record` was
 * replaced by `check` and `settle`, the example went on parsing cleanly and
 * would have thrown on the first request anybody made to it. The lesson from
 * an earlier repository on this account was "run the tool, not only its
 * tests"; this is that lesson applied to the example.
 */

import { buildMessages } from '../src/boundary.mjs';
import { parseSSE, textDeltas } from '../src/stream.mjs';

const INSTRUCTIONS = 'You answer questions about our documentation. If the answer is not in the provided material, say so.';

export function createAskHandler({ client, budget, retrieve, model = 'a-model-name-from-configuration' }) {
  return async function ask(req, res) {
    // Identity comes from the session, never from the request body. A budget
    // keyed on something the caller supplies is a budget the caller can reset.
    const identity = req.session?.userId ?? req.ip;

    const question = String(req.body?.question ?? '').slice(0, 4000);
    const docs = await retrieve(question);

    // No redact() call here, and that is deliberate rather than an oversight:
    // buildMessages redacts both the untrusted material and the question
    // unless redactInput is explicitly false. Calling it here as well would
    // read as though the protection lived in this file, and it does not.
    const messages = buildMessages({
      instructions: INSTRUCTIONS,
      untrusted: docs.map((doc) => ({ label: doc.id, text: doc.text })),
      question,
    });

    let reservation;
    try {
      reservation = budget.check(identity, messages);
    } catch {
      return res.status(429).json({ error: 'This feature is rate limited. Try again shortly.' });
    }

    // The abort path only matters if something triggers it. Without this
    // listener, a user closing the tab leaves the upstream request running and
    // billing until it finishes on its own.
    const controller = new AbortController();
    res.on('close', () => controller.abort());

    let upstream;
    try {
      upstream = await client.request('/chat/completions', { model, messages, stream: true }, { signal: controller.signal });
    } catch (error) {
      // The reservation has to come back, or a provider outage quietly spends
      // every caller's budget on requests that never happened.
      budget.release(identity, reservation.receipt);

      // Degrade to something that still works. The page had a purpose before
      // this feature existed, and a provider outage should cost the feature,
      // not the page. Never surface the upstream error text: it can contain
      // the request, and the request can contain a customer's data.
      return res.status(503).json({
        error: 'The assistant is unavailable right now.',
        fallback: { searchUrl: `/search?q=${encodeURIComponent(question)}` },
        retryAfterMs: error?.retryAfterMs,
      });
    }

    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');

    let written = 0;
    for await (const delta of textDeltas(parseSSE(upstream.body), { signal: controller.signal })) {
      written += delta.length;
      res.write(delta);
    }

    // Settled with the provider's own usage figure when there is one. The
    // estimate got the request through the door; this is what is recorded.
    // Falling back to the estimate is the safe direction, because a stream
    // that ended without a usage frame still cost something.
    const reported = upstream.usage?.total_tokens;
    budget.settle(identity, reservation.receipt, reported ?? reservation.estimate);

    res.end();
    return { written };
  };
}
