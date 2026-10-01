'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { applyReviewedVerificationOverlays } = require('./lib/reviewed-verification-overlays');
const { effectiveDispositionCategory } = require('./build-nationwide-verification');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const baseRef = process.argv[2] || 'e777d09e';
const basePath = 'data/hpt-audit/nationwide-verification.json';
const currentPath = path.join(audit, 'nationwide-verification.json');
const outputPath = path.join(audit, 'nationwide-snapshot-bridge.json');
const baselineFile = process.env.HPT_NATIONWIDE_SNAPSHOT_BASELINE;
const baseBytes = baselineFile
  ? fs.readFileSync(path.resolve(root, baselineFile))
  : execFileSync('git', ['show', `${baseRef}:${basePath}`], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024
  });
const currentBytes = fs.readFileSync(currentPath);
const cohortPath = path.join(audit, 'reconciliation-891-baseline-member-roster-2026-09-27.json');
const cohortBytes = fs.readFileSync(cohortPath);
const base = JSON.parse(baseBytes.toString('utf8'));
const current = JSON.parse(currentBytes.toString('utf8'));
const reviewedCurrentRecords = applyReviewedVerificationOverlays(current.records, audit);
const cohort = JSON.parse(cohortBytes.toString('utf8'));

function effectiveCategory(record) {
  if (record.latest_observation_superseded) return 'superseded-by-reviewed-resolution';
  if (record.standing_evidence_retained) return 'standing-evidence-retained';
  if (String(record.disposition || '').startsWith('verified-')) return 'active-verification-claim';
  if (String(record.disposition || '').startsWith('scope-exempt')) return 'scope-exempt';
  return 'genuinely-unresolved';
}

function sourceObservationCategory(record) {
  if (String(record.disposition || '').startsWith('scope-exempt')) return 'scope-exempt';
  if (record.supported_identity_uncertainty) return 'supported-identity-uncertainty';
  if (record.latest_observation_superseded) return 'superseded-by-reviewed-resolution';
  if (record.standing_evidence_retained && record.disposition === 'pointer-facility-match-unresolved') return 'genuinely-unresolved';
  if (record.standing_evidence_retained) return 'standing-evidence-retained';
  if (String(record.disposition || '').startsWith('verified-')) return 'active-verification-claim';
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

function reviewedCategoryCounts(records) {
  const counts = {};
  for (const record of records) {
    const category = effectiveDispositionCategory(record);
    counts[category] = (counts[category] || 0) + 1;
  }
  return counts;
}

function sameCounts(left, right) {
  const sorted = value => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function assertUniqueComplete(records, label) {
  const ids = records.map(record => record.ccn);
  if (ids.length !== 5419 || new Set(ids).size !== 5419 || ids.some(ccn => !ccn)) {
    throw new Error(`${label} must contain exactly 5,419 unique CCNs`);
  }
}

assertUniqueComplete(base.records, 'Base snapshot');
assertUniqueComplete(current.records, 'Current snapshot');
assertUniqueComplete(reviewedCurrentRecords, 'Current effective reviewed snapshot');
if (!sameCounts(categoryCounts(base.records), base.summary.effective_counts)
  || !sameCounts(current.records.reduce((counts, record) => {
    const category = sourceObservationCategory(record);
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {}), current.summary.source_observation_effective_counts)
  || !sameCounts(reviewedCategoryCounts(reviewedCurrentRecords), current.summary.effective_counts)) {
  throw new Error('Per-record raw/effective categories do not match their snapshot summaries');
}

const baseByCcn = new Map(base.records.map(record => [record.ccn, record]));
const currentByCcn = new Map(reviewedCurrentRecords.map(record => [record.ccn, record]));
const currentSourceByCcn = new Map(current.records.map(record => [record.ccn, record]));
const baseIds = new Set(baseByCcn.keys());
const currentIds = new Set(currentByCcn.keys());
const added = [...currentIds].filter(ccn => !baseIds.has(ccn));
const removed = [...baseIds].filter(ccn => !currentIds.has(ccn));
if (added.length || removed.length) throw new Error('Snapshot CCN sets differ; refusing an incomplete bridge');

const transitionCounts = {};
const records = [...currentByCcn.keys()].sort().map(ccn => {
  const before = baseByCcn.get(ccn);
  const after = currentByCcn.get(ccn);
  const source = currentSourceByCcn.get(ccn);
  const from = effectiveCategory(before);
  const to = effectiveDispositionCategory(after);
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
    transition,
    current_source_observation_category: sourceObservationCategory(source),
    current_source_observation_disposition: source.disposition,
    current_source_observation_at: source.observed_at
  };
});

const baseCommit = process.env.HPT_NATIONWIDE_SNAPSHOT_BASE_COMMIT
  || execFileSync('git', ['rev-parse', baseRef], { cwd: root, encoding: 'utf8' }).trim();
const cohortMembers = [...new Set([...cohort.baseline_unresolved_ccns, ...cohort.baseline_pointer_denied_ccns])];
const cohortCategories = ['genuinely-unresolved', 'active-verification-claim', 'standing-evidence-retained',
  'superseded-by-reviewed-resolution', 'scope-exempt'];
const cohortGroups = cohort.current_crosswalk_ccns;
const cohortIds = cohortCategories.flatMap(category => cohortGroups[category] || []);
if (cohortMembers.length !== 720 || new Set(cohortIds).size !== 720
  || cohort.current_snapshot.sha256 !== crypto.createHash('sha256').update(currentBytes).digest('hex'))
  throw new Error('Exact 891-membership cohort crosswalk is stale or incomplete for the current snapshot');
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
  historical_891_membership_cohort: {
    roster_file: path.basename(cohortPath),
    roster_sha256: crypto.createHash('sha256').update(cohortBytes).digest('hex'),
    frozen_snapshot_generated_at: cohort.source_snapshot.generated_at,
    frozen_snapshot_sha256: cohort.source_snapshot.sha256,
    historical_membership_counts: { unresolved_category_memberships: 593,
      pointer_access_denied_memberships: 298, overlap_memberships: 171,
      total_category_memberships: 891, unique_ccns: cohortMembers.length },
    exact_member_set_recovered: true,
    current_snapshot_sha256: cohort.current_snapshot.sha256,
    current_category_counts: cohort.summary.current_effective_categories,
    current_category_ccns: Object.fromEntries(cohortCategories.map(category => [category, [...cohortGroups[category]].sort()]))
  },
  transition_counts: Object.fromEntries(Object.entries(transitionCounts).sort((a, b) => a[0].localeCompare(b[0]))),
  limitations: [
    'The 2026-09-17 all-CCN figure of 898 has no recovered exact dated membership roster.',
    'The exact 891 membership cohort is included as a distinct crosswalk. Snapshot category transitions do not by themselves prove evidence gains or successful case closure.'
  ],
  records
};

fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
execFileSync(process.execPath, [path.join(__dirname, 'build-nationwide-effective-audit.js')], { cwd: root, stdio: 'inherit' });
console.log(JSON.stringify({
  output: path.relative(root, outputPath),
  generated_at: artifact.generated_at,
  base_generated_at: artifact.base_snapshot.generated_at,
  ccns: records.length,
  transition_counts: artifact.transition_counts,
  historical_891_roster_reconstructed: true,
  historical_891_unique_ccns: cohortMembers.length,
  historical_891_current_unresolved: cohort.summary.current_effective_categories['genuinely-unresolved']
}, null, 2));
