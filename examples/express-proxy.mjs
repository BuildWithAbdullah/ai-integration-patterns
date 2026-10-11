/**
 * express-proxy.mjs
 *
 * A reference server putting every piece together. This file imports express,
 * so CI can only syntax-check it, which is why it contains nothing but wiring.
 * The handler is in handler.mjs and is driven by a real test against a stub
 * transport, because a syntax check does not notice a call to a method that no
 * longer exists, and that is exactly what happened here once.
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
import { createBudget } from '../src/budget.mjs';
import { createAskHandler } from './handler.mjs';

const app = express();
app.use(express.json({ limit: '256kb' }));

const client = createClient({ apiKey: process.env.OPENAI_API_KEY });
const budget = createBudget({ maxTokensPerRequest: 8000, maxTokensPerWindow: 100000 });

async function retrieve() {
  // Stands in for whatever retrieval you have. What matters for this file is
  // that whatever it returns is treated as untrusted, because a document
  // anyone can edit is an instruction anyone can write.
  return [];
}

// The handler itself lives in handler.mjs with its dependencies injected, so
// that test/handler.test.mjs can drive it with a stub transport and a stub
// response. This file is only the wiring, and the wiring is all a syntax check
// can usefully cover.
app.post('/api/ask', createAskHandler({
  client,
  budget,
  retrieve,
  model: process.env.OPENAI_MODEL,
}));

export default app;
