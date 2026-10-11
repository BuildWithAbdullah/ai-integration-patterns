/**
 * run-tests.mjs
 *
 * Run the suite and count what happened, by consuming the structured event
 * stream from `node:test` rather than by parsing a reporter's output.
 *
 * A verifier that reads reporter output breaks on a Node upgrade. Node 20 and
 * 22 print TAP when the output is piped and Node 24 prints the spec reporter
 * regardless, so a count scraped from `ok` lines is a count that silently
 * becomes zero one day. Naming `--test-reporter=tap` in the test script fixes
 * it and leaves the fragility in place. The events are objects and are
 * identical across versions.
 *
 * Two traps, both hit for real before this file was right:
 *
 * The stream has to be consumed with `for await`. Attaching named listeners to
 * an object stream does not read it, so nothing flows, `end` never fires, and
 * the check that was supposed to run at the end quietly never runs while the
 * process exits 0.
 *
 * Zero tests is a failure. A glob that matches nothing, or an import error
 * that takes a whole file out, otherwise reports a clean run.
 */

import { run } from 'node:test';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

export async function testFiles() {
  const entries = await readdir(join(root, 'test'));
  return entries.filter((name) => name.endsWith('.test.mjs')).sort().map((name) => join(root, 'test', name));
}

export async function runSuite({ concurrency = true } = {}) {
  const files = await testFiles();
  if (files.length === 0) throw new Error('no test files found, which is a failure and not a clean run');

  const counts = { pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  const failures = [];

  const stream = run({ files, concurrency });

  // for await, not stream.on(...). An object stream only flows once something
  // reads it, and a named listener is not a read.
  for await (const event of stream) {
    switch (event.type) {
      case 'test:pass':
        if (event.data.skip) counts.skipped++;
        else if (event.data.todo) counts.todo++;
        else counts.pass++;
        break;
      case 'test:fail':
        counts.fail++;
        failures.push({
          name: event.data.name,
          file: event.data.file,
          message: event.data.details?.error?.message ?? String(event.data.details?.error ?? 'no message'),
        });
        break;
      case 'test:cancelled':
        counts.cancelled++;
        failures.push({ name: event.data.name, file: event.data.file, message: 'cancelled' });
        break;
      default:
        break;
    }
  }

  const total = counts.pass + counts.fail + counts.cancelled + counts.skipped + counts.todo;
  if (total === 0) throw new Error('the run produced no test events at all');

  return { files, counts, failures, total };
}

// Guarded, because importing this file must not start a test run. Two modules
// in this repository did their work at import time once, and one of them wrote
// the artefact that the verifier was about to certify.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const { counts, failures, files } = await runSuite();

  for (const failure of failures) {
    console.error(`FAIL  ${failure.name}\n      ${failure.file}\n      ${failure.message}`);
  }

  const parts = [`${counts.pass} passed`];
  if (counts.fail) parts.push(`${counts.fail} failed`);
  if (counts.cancelled) parts.push(`${counts.cancelled} cancelled`);
  if (counts.skipped) parts.push(`${counts.skipped} skipped`);
  if (counts.todo) parts.push(`${counts.todo} todo`);
  console.log(`${parts.join(', ')} across ${files.length} files`);

  if (counts.pass === 0) {
    console.error('no test passed, which is a failure however green the output looks');
    process.exit(1);
  }
  process.exit(counts.fail + counts.cancelled > 0 ? 1 : 0);
}
