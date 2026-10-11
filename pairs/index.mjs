/**
 * index.mjs
 *
 * The pair table.
 *
 * Each entry names a directory holding three files: `naive.mjs`, an
 * implementation with a defect this repository actually shipped or that is the
 * ordinary first attempt at the problem; `fixed.mjs`, which re-exports what
 * `src/` does now; and `probe.mjs`, which exercises both and returns the set of
 * catalogue ids it observed.
 *
 * Three declarations per pair, all asserted in both directions:
 *
 *   fails     exactly what the probe must observe on the naive side. If a
 *             defect ever stops reproducing, the pair fails and somebody has
 *             to find out whether the probe rotted or the claim did.
 *
 *   residual  exactly what the probe must STILL observe on the fixed side.
 *             This is the honest half. A fix that cleared a residual would
 *             fail the build just as one that stopped clearing a defect does,
 *             which makes the limits in the README a fact rather than a claim.
 *
 *   clears    derived, never written: fails minus residual.
 */

export const PAIRS = [
  {
    id: '01',
    dir: '01-chunk-boundary',
    title: 'An event split across two reads',
    fails: ['prevented.chunk-boundary-split'],
    residual: [],
  },
  {
    id: '02',
    dir: '02-prototype-keys',
    title: 'Inherited property names on the trust boundary',
    fails: ['prevented.prototype-key-accepted', 'residual.injection-within-authority'],
    residual: ['residual.injection-within-authority'],
  },
  {
    id: '03',
    dir: '03-unenforced-constraints',
    title: 'Constraints the validator quietly does not implement',
    fails: ['prevented.unenforced-constraint'],
    residual: ['residual.format-not-enforced'],
  },
  {
    id: '04',
    dir: '04-retry-after-ceiling',
    title: 'Retry-After obeyed with no ceiling',
    fails: ['prevented.unbounded-retry-after'],
    residual: ['residual.work-still-not-done'],
  },
  {
    id: '05',
    dir: '05-budget-reservation',
    title: 'A window ceiling with nothing reserved against it',
    fails: ['prevented.unreserved-budget'],
    residual: [],
  },
  {
    id: '06',
    dir: '06-abort-while-idle',
    title: 'An abort that is only noticed when the next event arrives',
    fails: ['prevented.abort-ignored-while-idle', 'residual.provider-bills-until-hangup'],
    residual: ['residual.provider-bills-until-hangup'],
  },
  {
    id: '07',
    dir: '07-unredacted-context',
    title: 'Redaction that exists, is documented, and is never called',
    fails: ['prevented.unredacted-context', 'residual.redaction-misses-unlisted-formats'],
    residual: ['residual.redaction-misses-unlisted-formats'],
  },
  {
    id: '08',
    dir: '08-repair-on-truncation',
    title: 'A truncated response sent back for repair',
    fails: ['prevented.repair-on-truncation'],
    residual: [],
  },
  {
    id: '09',
    dir: '09-array-root',
    title: 'An array at the root reported as no JSON at all',
    fails: ['prevented.array-root-rejected'],
    residual: [],
  },
  {
    id: '10',
    dir: '10-identity-leak',
    title: 'One retained Map key per address ever seen',
    fails: ['prevented.identity-map-leak'],
    residual: [],
  },
];

export function clears(pair) {
  const residual = new Set(pair.residual);
  return pair.fails.filter((id) => !residual.has(id));
}

export async function load(pair) {
  const [naive, fixed, probe] = await Promise.all([
    import(`./${pair.dir}/naive.mjs`),
    import(`./${pair.dir}/fixed.mjs`),
    import(`./${pair.dir}/probe.mjs`),
  ]);
  return { naive, fixed, probe: probe.probe };
}
