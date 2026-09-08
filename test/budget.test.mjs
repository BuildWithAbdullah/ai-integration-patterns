import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBudget, estimateTokens, estimateMessages, BudgetError } from '../src/budget.mjs';

test('the estimate grows with input and is zero for nothing', () => {
  assert.equal(estimateTokens(''), 0);
  assert.ok(estimateTokens('a'.repeat(400)) > estimateTokens('a'.repeat(40)));
  assert.ok(estimateMessages([{ content: 'hello' }]) > estimateTokens('hello'));
});

test('a request over the per-request ceiling is refused before it is sent', () => {
  const budget = createBudget({ maxTokensPerRequest: 100 });
  assert.throws(
    () => budget.check('usr_1', [{ content: 'x'.repeat(10000) }]),
    (err) => err instanceof BudgetError && err.scope === 'request'
  );
});

test('a normal request passes and reports what it used', () => {
  const budget = createBudget({ maxTokensPerRequest: 10000 });
  const { estimate } = budget.check('usr_1', [{ content: 'a short question' }]);
  assert.ok(estimate > 0 && estimate < 100);
});

test("the window ceiling stops a loop of individually reasonable requests", () => {
  // Every one of these passes the per-request cap comfortably. A per-request
  // cap does nothing about ten thousand of them, which is why there are two
  // controls rather than one.
  const budget = createBudget({ maxTokensPerRequest: 10000, maxTokensPerWindow: 1000 });
  const message = [{ content: "another small question" }];

  let accepted = 0;
  let refused = null;
  for (let i = 0; i < 500; i++) {
    try {
      const { estimate } = budget.check("usr_1", message);
      budget.record("usr_1", estimate);
      accepted++;
    } catch (err) {
      refused = err;
      break;
    }
  }

  assert.ok(refused instanceof BudgetError, "the loop must eventually be stopped");
  assert.equal(refused.scope, "window");
  assert.ok(accepted > 1, "and not on the first request");
  assert.ok(budget.used("usr_1") <= 1000, "never over the ceiling");
});

test('budgets are per identity', () => {
  const budget = createBudget({ maxTokensPerWindow: 1000 });
  budget.record('usr_1', 999);
  assert.doesNotThrow(() => budget.check('usr_2', [{ content: 'hello' }]));
});

test('usage ages out of the window', () => {
  let clock = 1_000_000;
  const budget = createBudget({ maxTokensPerWindow: 1000, windowMs: 60_000, now: () => clock });
  budget.record('usr_1', 900);
  assert.equal(budget.used('usr_1'), 900);

  clock += 61_000;
  assert.equal(budget.used('usr_1'), 0, 'the hour rolled over');
  assert.doesNotThrow(() => budget.check('usr_1', [{ content: 'hello' }]));
});

test('record returns the running total for the window', () => {
  const budget = createBudget();
  budget.record('usr_1', 100);
  assert.equal(budget.record('usr_1', 250), 350);
});

test('the check throws rather than returning a flag', () => {
  // A budget check whose result can be ignored will eventually be ignored, by
  // a caller who did not know it existed.
  const budget = createBudget({ maxTokensPerRequest: 1 });
  assert.throws(() => budget.check('usr_1', [{ content: 'more than one token of text' }]), BudgetError);
});
