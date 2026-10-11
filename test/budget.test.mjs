import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBudget, estimateTokens, estimateMessages, BudgetError } from '../src/budget.mjs';

const say = (text) => [{ content: text }];

test('the estimate grows with input and is zero for nothing', () => {
  assert.equal(estimateTokens(''), 0);
  assert.ok(estimateTokens('a'.repeat(400)) > estimateTokens('a'.repeat(40)));
  assert.ok(estimateMessages(say('hello')) > estimateTokens('hello'));
});

test('content that is an array of blocks is measured, not stringified', () => {
  // String() on an array of blocks gives "[object Object]" and estimates a
  // long document at a handful of tokens. Estimating low is the dangerous
  // direction: the point of a pre-flight check is to refuse before sending.
  const long = 'word '.repeat(2000);
  const blocks = [{ type: 'text', text: long }];
  assert.ok(estimateTokens(blocks) > 1000, 'an array of blocks must be measured by its text');
  assert.ok(Math.abs(estimateTokens(blocks) - estimateTokens(long)) < 10);
});

test('a request over the per-request ceiling is refused before it is sent', () => {
  const budget = createBudget({ maxTokensPerRequest: 100 });
  assert.throws(
    () => budget.check('usr_1', say('x'.repeat(10000))),
    (err) => err instanceof BudgetError && err.scope === 'request',
  );
});

test('a normal request passes and reports what it used', () => {
  const budget = createBudget({ maxTokensPerRequest: 10000 });
  const { estimate, receipt } = budget.check('usr_1', say('a short question'));
  assert.ok(estimate > 0 && estimate < 100);
  assert.ok(receipt, 'a reservation must come back with a receipt to settle it against');
});

test('the window ceiling stops a loop of individually reasonable requests', () => {
  const budget = createBudget({ maxTokensPerRequest: 10000, maxTokensPerWindow: 1000 });
  let accepted = 0;
  let refused = null;

  for (let i = 0; i < 500; i++) {
    try {
      const { estimate, receipt } = budget.check('usr_1', say('another small question'));
      budget.settle('usr_1', receipt, estimate);
      accepted++;
    } catch (err) {
      refused = err;
      break;
    }
  }

  assert.ok(refused instanceof BudgetError, 'the loop must eventually be stopped');
  assert.equal(refused.scope, 'window');
  assert.ok(accepted > 1, 'and not on the first request');
  assert.ok(budget.used('usr_1') <= 1000, 'never over the ceiling');
});

test('the estimate is reserved at check time, so concurrent requests cannot all pass', () => {
  // The defect this replaced. check() returned, the caller awaited a request,
  // and recorded afterwards. In between, the recorded total had not moved, so
  // every request in flight for one identity measured against the same stale
  // number and all of them were admitted. A ceiling of 1000 took three
  // requests of 805: not a smaller ceiling, no ceiling, as long as the
  // requests arrived together.
  const budget = createBudget({ maxTokensPerRequest: 1e6, maxTokensPerWindow: 1000 });
  const message = say('x'.repeat(1600)); // roughly 405 tokens

  const admitted = [];
  for (let i = 0; i < 5; i++) {
    try { admitted.push(budget.check('one-client', message)); } catch { /* refused */ }
  }

  assert.ok(admitted.length <= 2, `the ceiling admitted ${admitted.length} concurrent requests`);
  assert.ok(budget.used('one-client') <= 1000);
});

test('a reservation is reconciled against the figure the provider reports', () => {
  const budget = createBudget({ maxTokensPerRequest: 1e6, maxTokensPerWindow: 10000 });
  const { estimate, receipt } = budget.check('usr_1', say('x'.repeat(4000)));
  assert.ok(estimate > 900);

  // The provider says it was much cheaper than the estimate feared. The
  // estimate got the request through the door; this is what is recorded.
  budget.settle('usr_1', receipt, 120);
  assert.equal(budget.used('usr_1'), 120);
});

test('a reservation for a request that never ran is given back', () => {
  const budget = createBudget({ maxTokensPerRequest: 1e6, maxTokensPerWindow: 1000 });
  const { receipt } = budget.check('usr_1', say('x'.repeat(2000)));
  assert.ok(budget.used('usr_1') > 400);

  budget.release('usr_1', receipt);
  assert.equal(budget.used('usr_1'), 0, 'a request that failed to send must not be charged for');
});

test('settling the same reservation twice is refused rather than double counted', () => {
  const budget = createBudget();
  const { receipt } = budget.check('usr_1', say('hello'));
  budget.settle('usr_1', receipt, 50);
  assert.throws(() => budget.settle('usr_1', receipt, 50), (err) => err instanceof BudgetError && err.scope === 'receipt');
  assert.equal(budget.used('usr_1'), 50);
});

test('budgets are per identity', () => {
  const budget = createBudget({ maxTokensPerRequest: 1e6, maxTokensPerWindow: 1000 });
  const { receipt } = budget.check('usr_1', say('x'.repeat(3800)));
  budget.settle('usr_1', receipt, 999);
  assert.doesNotThrow(() => budget.check('usr_2', say('hello')));
});

test('usage ages out of the window', () => {
  let clock = 1_000_000;
  const budget = createBudget({ maxTokensPerRequest: 1e6, maxTokensPerWindow: 1000, windowMs: 60_000, now: () => clock });
  const { receipt } = budget.check('usr_1', say('hello'));
  budget.settle('usr_1', receipt, 900);
  assert.equal(budget.used('usr_1'), 900);

  clock += 61_000;
  assert.equal(budget.used('usr_1'), 0, 'the hour rolled over');
  assert.doesNotThrow(() => budget.check('usr_1', say('hello')));
});

test('an identity is forgotten once it has nothing in the window', () => {
  // Keyed on a client address on a public endpoint, the first version kept one
  // Map key per address for the lifetime of the process. The entries expired;
  // the keys did not. Nothing in the code reads as a leak, and nothing
  // surfaces until the heap does.
  let clock = 0;
  const budget = createBudget({ maxTokensPerRequest: 1e6, maxTokensPerWindow: 1e6, windowMs: 1000, now: () => clock });

  for (let i = 0; i < 500; i++) {
    const { receipt } = budget.check(`198.51.100.${i}`, say('ping'));
    budget.settle(`198.51.100.${i}`, receipt, 10);
  }
  assert.equal(budget.identities(), 500, 'all five hundred are live inside the window');

  clock += 5000;
  assert.equal(budget.identities(), 0, 'and none of them is retained once the window has rolled past');
});

test('the check throws rather than returning a flag', () => {
  // A budget check whose result can be ignored will eventually be ignored, by
  // a caller who did not know it existed.
  const budget = createBudget({ maxTokensPerRequest: 1 });
  assert.throws(() => budget.check('usr_1', say('more than one token of text')), BudgetError);
});
