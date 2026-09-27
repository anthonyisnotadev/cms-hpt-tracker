'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const baseRef = process.argv[2] || 'e777d09e';
const basePath = 'data/hpt-audit/nationwide-verification.json';
const currentPath = path.join(audit, 'nationwide-verification.json');
const outputPath = path.join(audit, 'nationwide-snapshot-bridge.json');
const baseBytes = execFileSync('git', ['show', `${baseRef}:${basePath}`], {
  cwd: root,
  maxBuffer: 64 * 1024 * 1024
});
const currentBytes = fs.readFileSync(currentPath);
const base = JSON.parse(baseBytes.toString('utf8'));
const current = JSON.parse(currentBytes.toString('utf8'));

function effectiveCategory(record) {
  if (record.latest_observation_superseded) return 'superseded-by-reviewed-resolution';
  if (record.standing_evidence_retained) return 'standing-evidence-retained';
  if (String(record.disposition || '').startsWith('verified-')) return 'active-verification-claim';
  if (String(record.disposition || '').startsWith('scope-exempt')) return 'scope-exempt';
  return 'genuinely-unresolved';
}

function categoryCounts(records) {
  const counts = {};
  for (const record of records) {
    const category = effectiveCategory(record);
    counts[category] = (counts[category] || 0) + 1;
  }
  return counts;
}

function assertUniqueComplete(records, label) {
  const ids = records.map(record => record.ccn);
  if (ids.length !== 5419 || new Set(ids).size !== 5419 || ids.some(ccn => !ccn)) {
    throw new Error(`${label} must contain exactly 5,419 unique CCNs`);
  }
}

assertUniqueComplete(base.records, 'Base snapshot');
assertUniqueComplete(current.records, 'Current snapshot');
if (JSON.stringify(categoryCounts(base.records)) !== JSON.stringify(base.summary.effective_counts)
  || JSON.stringify(categoryCounts(current.records)) !== JSON.stringify(current.summary.effective_counts)) {
  throw new Error('Per-record effective categories do not match the source snapshot summaries');
}

const baseByCcn = new Map(base.records.map(record => [record.ccn, record]));
const currentByCcn = new Map(current.records.map(record => [record.ccn, record]));
const baseIds = new Set(baseByCcn.keys());
const currentIds = new Set(currentByCcn.keys());
const added = [...currentIds].filter(ccn => !baseIds.has(ccn));
const removed = [...baseIds].filter(ccn => !currentIds.has(ccn));
if (added.length || removed.length) throw new Error('Snapshot CCN sets differ; refusing an incomplete bridge');

const transitionCounts = {};
const records = [...currentByCcn.keys()].sort().map(ccn => {
  const before = baseByCcn.get(ccn);
  const after = currentByCcn.get(ccn);
  const from = effectiveCategory(before);
  const to = effectiveCategory(after);
  const transition = `${from} -> ${to}`;
  transitionCounts[transition] = (transitionCounts[transition] || 0) + 1;
  return {
    ccn,
    hospital_name: after.hospital_name,
    previous_effective_category: from,
    current_effective_category: to,
    previous_disposition: before.disposition,
    current_disposition: after.disposition,
    previous_observed_at: before.observed_at,
    current_observed_at: after.observed_at,
    transition
  };
});

const baseCommit = execFileSync('git', ['rev-parse', baseRef], { cwd: root, encoding: 'utf8' }).trim();
const artifact = {
  generated_at: current.summary.generated_at,
  purpose: 'Exact-CCN bridge between the last committed nationwide snapshot and the current rebuilt snapshot; this is not the missing 2026-09-25 891-member roster.',
  base_snapshot: {
    ref: baseRef,
    commit: baseCommit,
    generated_at: base.summary.generated_at,
    sha256: crypto.createHash('sha256').update(baseBytes).digest('hex'),
    counts: base.summary.effective_counts
  },
  current_snapshot: {
    file: 'nationwide-verification.json',
    generated_at: current.summary.generated_at,
    sha256: crypto.createHash('sha256').update(currentBytes).digest('hex'),
    counts: current.summary.effective_counts
  },
  coverage: {
    exact_ccn_join: true,
    base_ccns: base.records.length,
    current_ccns: current.records.length,
    added_ccns: 0,
    removed_ccns: 0
  },
  transition_counts: Object.fromEntries(Object.entries(transitionCounts).sort((a, b) => a[0].localeCompare(b[0]))),
  limitations: [
    'The historical 2026-09-25 accountability figure of 891 (593 genuinely unresolved plus 298 pointer-access-denied-to-client observations) has no matching dated per-CCN snapshot among the inspected canonical files.',
    'This bridge uses 2026-09-20 and current 2026-09-27 snapshots only. It does not identify which cases belonged to the intervening 891-member cohort, and transitions do not by themselves prove evidence gains or successful case closure.'
  ],
  records
};

fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({
  output: path.relative(root, outputPath),
  generated_at: artifact.generated_at,
  base_generated_at: artifact.base_snapshot.generated_at,
  ccns: records.length,
  transition_counts: artifact.transition_counts,
  historical_891_roster_reconstructed: false
}, null, 2));
