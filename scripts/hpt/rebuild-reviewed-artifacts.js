'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const steps = [
  'scripts/hpt/build-nationwide-verification.js',
  'scripts/hpt/reconcile-nationwide.js',
  'scripts/hpt/build-unresolved-investigation-worklist.js',
  'scripts/hpt/build-retained-identity-review-queue.js',
  'scripts/hpt/build-exact-address-alias-candidates.js',
  'scripts/hpt/build-address-variant-alias-candidates.js',
  'scripts/hpt/build-standing-evidence-followup-worklist.js',
  'scripts/hpt/build-same-campus-ccn-worklist.js',
  'scripts/hpt/build-recovered-unresolved-shortlist.js',
  'scripts/hpt/build-supported-uncertainty-worklist.js',
  'scripts/hpt/build-corpus-index-ccn-worklist.js',
  'scripts/hpt/audit-selected-pointer-attribution.js',
  'scripts/hpt/build-interventions.js',
  'scripts/hpt/build-cross-domain-pointer-inventory.js',
];

for (const script of steps) {
  const result = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = result.status || 1;
  if (process.exitCode) break;
}
