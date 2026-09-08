/**
 * express-proxy.mjs
 *
 * A reference server putting every piece together. It is checked for syntax in
 * CI and it is not run there, because running it needs a key and a network,
 * and a test that needs both is a test that is skipped.
 *
 * The single most important line in this file is that the API key is read from
 * the environment on the server. There is no arrangement of a browser-side
 * integration that keeps a key secret. Not an obfuscated build, not a key
 * fetched at runtime, not one split across two requests. If the browser can use
 * it, the person holding the browser has it, and the first they hear about it
 * is the bill.
 */

import express from 'express';
import { createClient } from '../src/client.mjs';
import { parseSSE, textDeltas } from '../src/stream.mjs';
import { buildMessages, redact } from '../src/boundary.mjs';
import { createBudget } from '../src/budget.mjs';

const app = express();
app.use(express.json({ limit: '256kb' }));

const client = createClient({ apiKey: process.env.OPENAI_API_KEY });
const budget = createBudget({ maxTokensPerRequest: 8000, maxTokensPerWindow: 100000 });

app.post('/api/ask', async (req, res) => {
  // Identity comes from the session, never from the request body. A budget
  // keyed on something the caller supplies is a budget the caller can reset.
  const identity = req.session?.userId ?? req.ip;

  const messages = buildMessages({
    instructions: 'You answer questions about our documentation. If the answer is not in the provided material, say so.',
    untrusted: (await retrieveDocs(req.body.question)).map((doc) => ({ label: doc.id, text: doc.text })),
    question: redact(String(req.body.question ?? '').slice(0, 4000)),
  });

  try {
    budget.check(identity, messages);
  } catch (error) {
    return res.status(429).json({ error: 'This feature is rate limited. Try again shortly.' });
  }

  // The client's abort path only matters if something triggers it. Without
  // this listener, a user closing the tab leaves the upstream request running
  // and billing until it completes on its own.
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  let upstream;
  try {
    upstream = await client.request('/chat/completions', {
      model: process.env.OPENAI_MODEL,
      messages,
      stream: true,
    }, { signal: controller.signal });
  } catch (error) {
    // Degrade to something that still works. The page had a purpose before
    // this feature existed, and a provider outage should cost the feature, not
    // the page. Never surface the upstream error text: it can contain the
    // request, and the request can contain a customer's data.
    return res.status(503).json({
      error: 'The assistant is unavailable right now.',
      fallback: { searchUrl: `/search?q=${encodeURIComponent(req.body.question ?? '')}` },
    });
  }

  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('cache-control', 'no-store');

  let tokens = 0;
  for await (const delta of textDeltas(parseSSE(upstream.body), { signal: controller.signal })) {
    tokens += 1;
    res.write(delta);
  }
  budget.record(identity, tokens);
  res.end();
});

async function retrieveDocs() {
  // Stands in for whatever retrieval you have. What matters for this file is
  // that whatever it returns is treated as untrusted, because a document
  // anyone can edit is an instruction anyone can write.
  return [];
}

export default app;
