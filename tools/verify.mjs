/**
 * verify.mjs
 *
 * Assertions about the repository itself, rather than about the code.
 *
 * The suite checks that the modules behave. This checks that the repository
 * does not quietly contradict itself: that every module is importable and
 * exports what the docs name, that every pair has its three files, that every
 * catalogued finding is referenced somewhere a reader will find it, that the
 * forbidden characters are absent, and that the numbers printed in the README
 * are the numbers this run produced.
 *
 * The last one is the one worth having. A README that quotes a test count is
 * a README that is wrong within a week unless something compares the two.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, extname } from 'node:path';

import { FINDINGS, byKind } from './catalogue.mjs';
import { PAIRS, clears } from '../pairs/index.mjs';
import { runSuite } from './run-tests.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const TEXT = new Set(['.mjs', '.js', '.md', '.json', '.yml', '.yaml', '']);
const SKIP_DIRS = new Set(['.git', 'node_modules']);

let passed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) passed++;
  else failures.push(message);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github' && entry.name !== '.gitignore') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...await walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

// The needles are assembled from code points rather than written out, because
// the rule covers this file too and a literal would make the check fail on its
// own source. Found the hard way, twice.
const EM_DASH = String.fromCharCode(8212);
const EN_DASH = String.fromCharCode(8211);

async function main() {
  const files = (await walk(root)).sort();
  const textFiles = files.filter((f) => TEXT.has(extname(f)));

  assert(files.length > 40, `expected a repository of more than forty files, found ${files.length}`);

  // -------------------------------------------------------- per text file
  for (const file of textFiles) {
    const rel = relative(root, file);
    const body = await readFile(file, 'utf8');

    assert(body.length > 0, `${rel} is empty`);
    assert(!body.includes(EM_DASH) && !body.includes(EN_DASH), `${rel} contains a dash character this repository does not use`);
    assert(!/[ \t]+$/m.test(body) || rel === 'LICENSE', `${rel} has trailing whitespace`);
    assert(body.endsWith('\n'), `${rel} does not end with a newline`);
  }

  // ------------------------------------------------------------- modules
  const sources = files.filter((f) => f.includes(`${'src'}/`) && f.endsWith('.mjs'));
  assert(sources.length === 6, `expected six modules in src, found ${sources.length}`);

  const EXPECTED_EXPORTS = {
    'boundary.mjs': ['buildMessages', 'sanitiseUntrusted', 'redact'],
    'budget.mjs': ['createBudget', 'estimateTokens', 'estimateMessages', 'BudgetError'],
    'client.mjs': ['createClient', 'backoffMs', 'parseRetryAfter', 'TransientError', 'PermanentError', 'RetryLaterError', 'DeadlineError'],
    'stream.mjs': ['parseSSE', 'parseEvent', 'textDeltas'],
    'structured.mjs': ['extractJSON', 'requestStructured', 'StructuredError', 'TruncatedError'],
    'tools.mjs': ['createRegistry', 'validate', 'assertSchema', 'ToolError', 'SchemaError'],
  };

  for (const [name, expected] of Object.entries(EXPECTED_EXPORTS)) {
    const module = await import(`../src/${name}`);
    for (const exportName of expected) {
      assert(module[exportName] !== undefined, `src/${name} does not export ${exportName}`);
    }
  }

  // No module may do its work at import time. Two did, and importing the
  // bundler in a sibling repository wrote the artefact the verifier was about
  // to certify.
  for (const file of [...sources, join(root, 'tools', 'run-tests.mjs'), join(root, 'tools', 'catalogue.mjs')]) {
    const body = await readFile(file, 'utf8');
    const rel = relative(root, file);
    // A bare call or a top-level await at column zero, which is what running
    // at import time actually looks like. Anything behind a process.argv[1]
    // guard is a file that is also a command, which is allowed.
    const guarded = body.includes('process.argv[1]');
    const sideEffects = [...body.matchAll(/^(?:await\s+)?[A-Za-z_$][\w$.]*\s*\(/gm)]
      .map((m) => m[0].trim())
      .filter((call) => !/^(?:export|import|if|for|while|switch|catch|function|return|typeof)\b/.test(call));
    assert(guarded || sideEffects.length === 0,
      `${rel} appears to do work at import time: ${sideEffects.slice(0, 2).join(' ')}`);
  }

  // --------------------------------------------------------------- pairs
  const pairDirs = (await readdir(join(root, 'pairs'), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  assert(pairDirs.length === PAIRS.length, `${pairDirs.length} pair directories against ${PAIRS.length} table entries`);
  assert(PAIRS.length === 10, `expected ten pairs, found ${PAIRS.length}`);

  for (const pair of PAIRS) {
    for (const part of ['naive.mjs', 'fixed.mjs', 'probe.mjs']) {
      const path = join(root, 'pairs', pair.dir, part);
      const info = await stat(path).catch(() => null);
      assert(info?.isFile(), `pairs/${pair.dir}/${part} is missing`);
      // naive.mjs and probe.mjs carry the argument and have to be substantial.
      // fixed.mjs is a re-export of what src/ already does, and should be,
      // because a pair whose fixed side is a second copy of the shipped code
      // is a pair that can pass while the shipped code is broken.
      if (info && part === 'fixed.mjs') {
        const body = await readFile(path, 'utf8');
        assert(body.includes('../../src/'), `pairs/${pair.dir}/fixed.mjs must re-export from src rather than reimplement it`);
      } else if (info) {
        assert(info.size > 400, `pairs/${pair.dir}/${part} is too small to be a real example`);
      }
    }

    const naive = await readFile(join(root, 'pairs', pair.dir, 'naive.mjs'), 'utf8');
    assert(/\/\*\*[\s\S]*?\*\//.test(naive), `pairs/${pair.dir}/naive.mjs does not explain what is wrong with it`);
    assert(clears(pair).length > 0, `pair ${pair.id} clears nothing`);
    assert(pair.title.length > 15, `pair ${pair.id} has no real title`);
  }

  // ----------------------------------------------------------- catalogue
  const prose = await Promise.all(
    files.filter((f) => f.endsWith('.md')).map((f) => readFile(f, 'utf8')),
  ).then((bodies) => bodies.join('\n'));
  const code = await Promise.all(textFiles.filter((f) => f.endsWith('.mjs')).map((f) => readFile(f, 'utf8')))
    .then((bodies) => bodies.join('\n'));

  assert(FINDINGS.length === 61, `expected 61 catalogued findings, found ${FINDINGS.length}`);
  assert(byKind('rejected').length === 46, `expected 46 rejected findings, found ${byKind('rejected').length}`);
  assert(byKind('prevented').length === 10, `expected 10 prevented findings, found ${byKind('prevented').length}`);
  assert(byKind('residual').length === 5, `expected 5 residual findings, found ${byKind('residual').length}`);

  for (const finding of FINDINGS) {
    assert(finding.id.includes('.'), `${finding.id} is not group.slug`);
    if (finding.kind !== 'rejected') {
      assert(code.includes(`'${finding.id}'`), `${finding.id} is catalogued but no probe ever observes it`);
    }
  }

  // ------------------------------------------------------- docs and CI
  for (const required of ['README.md', 'LICENSE', 'package.json', '.github/workflows/verify.yml']) {
    const info = await stat(join(root, required)).catch(() => null);
    assert(info?.isFile(), `${required} is missing`);
  }

  const docs = (await readdir(join(root, 'docs'))).filter((f) => f.endsWith('.md'));
  assert(docs.length >= 5, `expected at least five documents in docs, found ${docs.length}`);

  // The example has to be exercised, not only parsed. It was only ever
  // syntax-checked, and when the budget API changed it went on parsing
  // cleanly while calling a method that no longer existed.
  const handlerTest = await readFile(join(root, 'test', 'handler.test.mjs'), 'utf8').catch(() => '');
  assert(handlerTest.includes('createAskHandler'), 'the reference handler is not driven by any test');
  const wiring = await readFile(join(root, 'examples', 'express-proxy.mjs'), 'utf8');
  assert(wiring.includes('./handler.mjs'), 'the express example should wire the tested handler rather than hold its own copy');
  assert(!/budget\.(record|used)\(/.test(await readFile(join(root, 'examples', 'handler.mjs'), 'utf8')),
    'the handler calls a budget method that no longer exists');

  const licence = await readFile(join(root, 'LICENSE'), 'utf8');
  assert(/MIT License/i.test(licence), 'LICENSE is not the MIT licence');

  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert(pkg.scripts?.test, 'package.json has no test script');
  assert(pkg.scripts?.verify, 'package.json has no verify script');
  assert(pkg.engines?.node, 'package.json declares no Node engine range');
  assert(!pkg.dependencies, 'this repository has no dependencies and should declare none');

  const readme = await readFile(join(root, 'README.md'), 'utf8');
  assert(/^## Verifying$/m.test(readme), 'the README has no Verifying section');
  assert(/^## What this does not do$/m.test(readme), 'the README does not state its limits under a heading of their own');
  assert(!/FAST|NUCES|university/i.test(readme), 'the README mentions education');
  assert(readme.includes('MIT'), 'the README does not name the licence');

  // -------------------------------------- the numbers the README quotes
  //
  // Matched as whole lines against the run's own totals, not by pulling a
  // number out with a pattern. A pattern that reads the first integer near a
  // phrase will happily agree with a line that says "275 of 325 assertions
  // passed", which is how a broken sentence shipped once with a green check
  // beside it.
  const { counts } = await runSuite({ concurrency: false });
  const quoted = [
    [`${counts.pass} tests`, 'the test count'],
    [`${FINDINGS.length} catalogued failure modes`, 'the catalogue size'],
    [`${PAIRS.length} fail and pass pairs`, 'the pair count'],
  ];

  for (const [phrase, what] of quoted) {
    const occurrences = readme.split('\n').filter((line) => line.includes(phrase)).length;
    assert(occurrences >= 1, `the README does not state ${what} as the exact phrase "${phrase}"`);
  }

  // And no stale figure of the same shape anywhere in the README.
  for (const [pattern, expected, what] of [
    [/(\d+) tests\b/g, String(counts.pass), 'test count'],
    [/(\d+) catalogued failure modes/g, String(FINDINGS.length), 'catalogue size'],
    [/(\d+) fail and pass pairs/g, String(PAIRS.length), 'pair count'],
  ]) {
    for (const match of readme.matchAll(pattern)) {
      assert(match[1] === expected, `the README says "${match[0]}" where the ${what} is ${expected}`);
    }
  }

  assert(counts.pass > 0, 'the suite passed no tests');
  assert(counts.fail === 0, `the suite has ${counts.fail} failing tests`);

  // ----------------------------------------- the assertion count itself
  //
  // Counted including this comparison, so the figure in the README is the
  // figure a reader gets when they run the command. Compared as an exact
  // whole phrase, and then every occurrence of the same shape anywhere in the
  // file is compared too, because two copies of a number are two chances to
  // be wrong and a loose pattern will happily agree with the broken one.
  const PHRASE = 'assertions about the repository';
  const expectedTotal = passed + failures.length + 1;
  const stated = readme.split('\n')
    .flatMap((line) => [...line.matchAll(new RegExp(`(\\d+) ${PHRASE}`, 'g'))].map((m) => m[1]));

  assert(
    stated.length >= 2 && stated.every((n) => n === String(expectedTotal)),
    stated.length < 2
      ? `the README must state the assertion total as "${expectedTotal} ${PHRASE}" in both the summary and the Verifying section`
      : `the README states ${stated.filter((n) => n !== String(expectedTotal)).join(' and ')} ${PHRASE} where the total is ${expectedTotal}`,
  );

  // --------------------------------------------------------------- report
  console.log(`${passed} of ${passed + failures.length} repository assertions passed`);
  console.log(`${counts.pass} tests, ${FINDINGS.length} catalogued failure modes, ${PAIRS.length} fail and pass pairs`);

  if (failures.length > 0) {
    console.error('');
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
}

await main();
