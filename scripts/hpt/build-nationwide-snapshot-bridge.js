'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { applyReviewedVerificationOverlays } = require('./lib/reviewed-verification-overlays');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const baseRef = process.argv[2] || 'e777d09e';
const basePath = 'data/hpt-audit/nationwide-verification.json';
const currentPath = path.join(audit, 'nationwide-verification.json');
const outputPath = path.join(audit, 'nationwide-snapshot-bridge.json');
const reconciliationPath = path.join(audit, 'nationwide-reconciliation.json');
const effectiveAuditPath = path.join(audit, 'nationwide-effective-audit.json');
const cohortPath = path.join(audit, 'reconciliation-891-baseline-member-roster-2026-09-27.json');
const baseBytes = execFileSync('git', ['show', `${baseRef}:${basePath}`], {
  cwd: root,
  maxBuffer: 64 * 1024 * 1024
});
const currentBytes = fs.readFileSync(currentPath);
const cohortBytes = fs.readFileSync(cohortPath);
const base = JSON.parse(baseBytes.toString('utf8'));
const current = JSON.parse(currentBytes.toString('utf8'));
const cohort = JSON.parse(cohortBytes.toString('utf8'));
const reconciliationBytes = fs.readFileSync(reconciliationPath);
const reconciliation = JSON.parse(reconciliationBytes.toString('utf8'));
const effectiveRows = applyReviewedVerificationOverlays(current.records, audit);
const overlaysDoc = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-nationwide-verification-overlays.json'), 'utf8'));
const overlaysByCcn = new Map(overlaysDoc.records.map(record => [record.ccn, record]));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

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

const cohortMembers = [...new Set([
  ...cohort.baseline_unresolved_ccns,
  ...cohort.baseline_pointer_denied_ccns
])].sort();
const cohortCategories = [
  'genuinely-unresolved',
  'active-verification-claim',
  'standing-evidence-retained',
  'superseded-by-reviewed-resolution',
  'scope-exempt'
];
const cohortGroups = cohort.current_crosswalk_ccns;
const reconciliationByCcn = new Map(reconciliation.records.map(record => [record.ccn, record]));
if (reconciliationByCcn.size !== 5419 || effectiveRows.length !== 5419)
  throw new Error('Effective verification and reconciliation must each cover all 5,419 CCNs');
const cohortCurrentIds = cohortCategories.flatMap(category => cohortGroups[category] || []);
if (cohortMembers.length !== 720
  || cohort.summary.category_membership_sum !== 891
  || cohort.summary.unresolved_ccns !== 593
  || cohort.summary.pointer_access_denied_ccns !== 298
  || cohort.summary.overlap_ccns !== 171
  || new Set(cohortCurrentIds).size !== 720
  || cohortCurrentIds.some(ccn => !cohortMembers.includes(ccn))
  || cohort.current_snapshot.sha256 !== digest(currentBytes)
  || cohort.current_snapshot.generated_at !== current.summary.generated_at) {
  throw new Error('The frozen Sep. 25 891-membership cohort does not reconcile to the current snapshot');
}
const cohortCurrentCounts = Object.fromEntries(cohortCategories.map(category => [
  category,
  (cohortGroups[category] || []).length
]));

const transitionCounts = {};
const categoryForEffective = record => record.latest_observation_superseded ? 'superseded-by-reviewed-resolution'
  : record.standing_evidence_retained ? 'standing-evidence-retained'
    : String(record.disposition || '').startsWith('verified-') ? 'active-verification-claim'
      : String(record.disposition || '').startsWith('scope-exempt') ? 'scope-exempt' : 'genuinely-unresolved';
const effectiveByCcn = new Map(effectiveRows.map(record => [record.ccn, record]));
const cohortMemberSet = new Set(cohortMembers);
const auditRecords = [...currentByCcn.keys()].sort().map(ccn => {
  const raw = currentByCcn.get(ccn);
  const effective = effectiveByCcn.get(ccn);
  const review = reconciliationByCcn.get(ccn);
  const overlay = overlaysByCcn.get(ccn);
  if (!effective || !review) throw new Error(`Missing exact-CCN effective audit join for ${ccn}`);
  return {
    ccn,
    hospital_name: raw.hospital_name,
    state: raw.state,
    historical_891_member: cohortMemberSet.has(ccn),
    historical_891_current_category: cohortMemberSet.has(ccn)
      ? categoryForEffective(effective) : '',
    raw_observation: {
      disposition: raw.disposition,
      observed_at: raw.observed_at,
      mrf_http_status: String(raw.mrf_http_status || ''),
      mrf_url: raw.mrf_url || '',
      browser_mrf_status: raw.browser_mrf_status || '',
      browser_mrf_observed_at: raw.browser_mrf_observed_at || '',
      pointer_state: raw.pointer_state || '',
      pointer_result: raw.pointer_result || '',
      pointer_observed_at: raw.pointer_observed_at || '',
      next_action: raw.next_action || ''
    },
    effective_reviewed_observation: {
      disposition: effective.disposition,
      observed_at: effective.observed_at,
      mrf_http_status: String(effective.mrf_http_status || ''),
      mrf_url: effective.mrf_url || '',
      standing_evidence_retained: !!effective.standing_evidence_retained,
      latest_observation_superseded: !!effective.latest_observation_superseded,
      latest_retry_observation: effective.latest_retry_observation || null,
      reviewed_page_file_overlay: effective.reviewed_page_file_overlay || '',
      overlay_root_pointer_observation: overlay?.root_pointer_observation || null,
      overlay_source_proof_file: overlay?.source_proof_file || ''
    },
    reconciliation: {
      workstream: review.workstream,
      status: review.reconciliation_status,
      issues: review.issues,
      latest_observed_at: review.latest_observed_at,
      next_action: review.next_action,
      actionable: !!review.actionable
    }
  };
});
const auditCounts = auditRecords.reduce((out, record) => {
  const category = categoryForEffective(effectiveByCcn.get(record.ccn));
  out.effective_category[category] = (out.effective_category[category] || 0) + 1;
  out.reconciliation_status[record.reconciliation.status] = (out.reconciliation_status[record.reconciliation.status] || 0) + 1;
  out.workstream[record.reconciliation.workstream] = (out.workstream[record.reconciliation.workstream] || 0) + 1;
  if (record.historical_891_member) {
    out.historical_891_category[record.historical_891_current_category] =
      (out.historical_891_category[record.historical_891_current_category] || 0) + 1;
  }
  return out;
}, { effective_category: {}, reconciliation_status: {}, workstream: {}, historical_891_category: {} });
const effectiveAudit = {
  generated_at: current.summary.generated_at,
  purpose: 'Exact-CCN reproducible reconciliation of raw nationwide observations, validated reviewed overlays, reconciliation issues/workstreams, and the frozen historical 891-membership cohort.',
  inputs: {
    nationwide_verification: { file: 'nationwide-verification.json', sha256: digest(currentBytes) },
    nationwide_reconciliation: { file: 'nationwide-reconciliation.json', sha256: digest(reconciliationBytes) },
    historical_891_roster: { file: path.basename(cohortPath), sha256: digest(cohortBytes) }
  },
  coverage: { exact_ccn_join: true, nationwide_ccns: auditRecords.length,
    historical_891_memberships: cohort.summary.category_membership_sum,
    historical_891_unique_ccns: cohortMembers.length,
    historical_891_overlap_memberships: cohort.summary.overlap_ccns },
  counts: auditCounts,
  limitations: [
    'Raw source observations remain immutable and can differ from the effective reviewed view when a retained, hash-validated overlay applies.',
    'Reconciliation issue counts can overlap; they are not additive hospital counts.',
    'The historical 2026-09-17 all-CCN target of 898 has no recovered exact per-CCN roster and is not represented as a membership crosswalk.'
  ],
  records: auditRecords
};
fs.writeFileSync(effectiveAuditPath, `${JSON.stringify(effectiveAudit, null, 2)}\n`);
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
  purpose: 'Exact-CCN bridge between the last committed nationwide snapshot and the current rebuilt snapshot, including the recovered exact 2026-09-25 891-membership cohort crosswalk.',
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
    roster_sha256: digest(cohortBytes),
    frozen_snapshot_generated_at: cohort.source_snapshot.generated_at,
    frozen_snapshot_sha256: cohort.source_snapshot.sha256,
    historical_membership_counts: {
      unresolved_category_memberships: cohort.summary.unresolved_ccns,
      pointer_access_denied_memberships: cohort.summary.pointer_access_denied_ccns,
      overlap_memberships: cohort.summary.overlap_ccns,
      total_category_memberships: cohort.summary.category_membership_sum,
      unique_ccns: cohortMembers.length
    },
    exact_member_set_recovered: true,
    current_snapshot_sha256: cohort.current_snapshot.sha256,
    current_category_counts: cohortCurrentCounts,
    current_category_ccns: Object.fromEntries(cohortCategories.map(category => [
      category,
      [...(cohortGroups[category] || [])].sort()
    ]))
  },
  transition_counts: Object.fromEntries(Object.entries(transitionCounts).sort((a, b) => a[0].localeCompare(b[0]))),
  limitations: [
    'The separate 2026-09-17 all-CCN figure of 898 unresolved has no recovered exact dated per-CCN membership roster; this bridge does not claim an 898-to-current historical member crosswalk.',
    'The exact 2026-09-25 accountability roster is recovered and included above: 891 overlapping category memberships represent 720 unique CCNs. Category transitions do not by themselves prove evidence gains or successful case closure.'
  ],
  records
};

fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({
  output: path.relative(root, outputPath),
  effective_audit_output: path.relative(root, effectiveAuditPath),
  generated_at: artifact.generated_at,
  base_generated_at: artifact.base_snapshot.generated_at,
  ccns: records.length,
  transition_counts: artifact.transition_counts,
  historical_891_roster_reconstructed: true,
  historical_891_unique_ccns: cohortMembers.length,
  historical_891_current_unresolved: cohortCurrentCounts['genuinely-unresolved'],
  effective_audit_ccns: auditRecords.length,
  effective_audit_counts: auditCounts
}, null, 2));
