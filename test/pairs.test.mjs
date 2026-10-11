/**
 * The pairs, graded in both directions.
 *
 * A corrected example on its own asserts nothing. It is a piece of code that
 * works, sitting next to a paragraph claiming that something else would not,
 * and the claim is exactly as good as the reader's willingness to believe it.
 * The naive file is what turns it into a measurement.
 *
 * Three assertions per pair:
 *
 *   the naive side exhibits exactly what the table says it exhibits, so a
 *   defect that stops reproducing is a build failure rather than a quiet
 *   decay into a pair that proves nothing;
 *
 *   the fixed side exhibits exactly the declared residual, so a fix that
 *   stopped working fails and so does one that appears to clear a limit this
 *   repository says it cannot clear;
 *
 *   the two sides actually differ, so a pair whose files have drifted into
 *   agreement cannot sit here looking like evidence.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PAIRS, clears, load } from '../pairs/index.mjs';
import { byKind, find } from '../tools/catalogue.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pairsDir = join(here, '..', 'pairs');
const sorted = (set) => [...set].sort();

for (const pair of PAIRS) {
  test(`pair ${pair.id}: ${pair.title}`, async () => {
    const { naive, fixed, probe } = await load(pair);

    const onNaive = sorted(await probe(naive));
    const onFixed = sorted(await probe(fixed));

    assert.deepEqual(onNaive, sorted(pair.fails),
      `the naive implementation must exhibit exactly what pair ${pair.id} declares`);
    assert.deepEqual(onFixed, sorted(pair.residual),
      `the shipped implementation must exhibit exactly the residual pair ${pair.id} declares`);

    const cleared = clears(pair);
    assert.ok(cleared.length > 0, `pair ${pair.id} clears nothing, so it is not a pair`);
    for (const id of cleared) {
      assert.ok(onNaive.includes(id) && !onFixed.includes(id), `pair ${pair.id} does not actually clear ${id}`);
    }
  });
}

test('every pair directory is in the table and every table entry exists on disk', async () => {
  const onDisk = (await readdir(pairsDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  assert.deepEqual(onDisk, PAIRS.map((p) => p.dir).sort(),
    'a pair directory that is not in the table is a pair nothing grades');
});

test('each pair clears at least one catalogued finding and declares only catalogued residuals', () => {
  const prevented = new Set(byKind('prevented'));
  const residual = new Set(byKind('residual'));

  for (const pair of PAIRS) {
    for (const id of pair.fails) {
      assert.ok(prevented.has(id) || residual.has(id), `pair ${pair.id} declares ${id}, which is not catalogued`);
    }
    for (const id of pair.residual) {
      assert.ok(residual.has(id), `pair ${pair.id} declares residual ${id}, which is not catalogued as a residual`);
      assert.equal(find(id).pair, pair.id, `${id} is catalogued against pair ${find(id).pair}, not ${pair.id}`);
    }
  }
});

test('every prevented finding is cleared by the pair it names', async () => {
  for (const id of byKind('prevented')) {
    const finding = find(id);
    const pair = PAIRS.find((p) => p.id === finding.pair);
    assert.ok(pair, `${id} names pair ${finding.pair}, which is not in the table`);
    assert.ok(clears(pair).includes(id), `${id} is catalogued as prevented but pair ${pair.id} does not clear it`);
  }
});
