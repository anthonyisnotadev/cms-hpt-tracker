'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const steps = [
  'scripts/hpt/build-nationwide-verification.js',
  // Reconcile must consume the proof audit generated from the current
  // nationwide view; running this after reconciliation leaves stale proof-gap
  // issues in nationwide-reconciliation.json until the next run.
  'scripts/hpt/audit-nationwide-source-proof.js',
  'scripts/hpt/reconcile-nationwide.js',
  'scripts/hpt/build-unresolved-investigation-worklist.js',
  'scripts/hpt/build-identity-quarantine-worklist.js',
  'scripts/hpt/build-retained-identity-review-queue.js',
  'scripts/hpt/build-exact-address-alias-candidates.js',
  'scripts/hpt/build-address-variant-alias-candidates.js',
  'scripts/hpt/build-standing-evidence-followup-worklist.js',
  'scripts/hpt/build-same-campus-ccn-worklist.js',
  'scripts/hpt/build-recovered-unresolved-shortlist.js',
  'scripts/hpt/build-supported-uncertainty-worklist.js',
  'scripts/hpt/build-corpus-index-ccn-worklist.js',
  'scripts/hpt/audit-selected-pointer-attribution.js',
  'scripts/hpt/update-891-cohort-crosswalk.js',
  'scripts/hpt/build-nationwide-snapshot-bridge.js',
  'scripts/hpt/build-interventions.js',
  'scripts/hpt/build-cross-domain-pointer-inventory.js',
  'scripts/hpt/audit-unresolved-support.js',
  // Human-readable History text is derived from the current reviewed view and
  // per-CCN resolutions; refresh it before embedding that history in tracker.html.
  'scripts/hpt/rewrite-readable-history.js',
  'scripts/build-tracker.js',
];

for (const script of steps) {
  let result;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    result = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit' });
    if (result.status === 0) break;
    // Windows occasionally reports a transient sharing violation while a
    // generated audit artifact is being replaced. Give the reader/scan handle
    // time to close before retrying the exact step, so a recoverable race
    // cannot leave the derived tracker stale.
    if (attempt < 6) spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 750)'], { cwd: root, stdio: 'ignore' });
  }
  if (result.status !== 0) process.exitCode = result.status || 1;
  if (process.exitCode) break;
}
