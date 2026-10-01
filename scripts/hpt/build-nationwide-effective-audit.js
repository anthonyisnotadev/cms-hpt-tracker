'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { applyReviewedVerificationOverlays } = require('./lib/reviewed-verification-overlays');
const { effectiveDispositionCategory } = require('./build-nationwide-verification');

const root = path.resolve(__dirname, '../..');
const auditDir = path.join(root, 'data/hpt-audit');
const read = name => fs.readFileSync(path.join(auditDir, name));
const snapshotBytes = read('nationwide-verification.json');
const reconciliationBytes = read('nationwide-reconciliation.json');
const rosterBytes = read('reconciliation-891-baseline-member-roster-2026-09-27.json');
const overlaysBytes = read('reconciliation-nationwide-verification-overlays.json');
const worklistBytes = read('unresolved-investigation-worklist.json');
const snapshot = JSON.parse(snapshotBytes);
const reconciliation = JSON.parse(reconciliationBytes);
const roster = JSON.parse(rosterBytes);
const overlays = JSON.parse(overlaysBytes);
const worklist = JSON.parse(worklistBytes);
const effective = applyReviewedVerificationOverlays(snapshot.records, auditDir);
const effectiveByCcn = new Map(effective.map(row => [row.ccn, row]));
const reconciliationByCcn = new Map(reconciliation.records.map(row => [row.ccn, row]));
const overlaysByCcn = new Map(overlays.records.map(row => [row.ccn, row]));
const worklistByCcn = new Map(worklist.records.map(row => [row.ccn, row]));
const members = new Set([...roster.baseline_unresolved_ccns, ...roster.baseline_pointer_denied_ccns]);
if (effectiveByCcn.size !== 5419 || reconciliationByCcn.size !== 5419 || members.size !== 720)
  throw new Error('Effective audit inputs do not cover the exact expected CCN sets');
const expectedWorklistCcns = reconciliation.records
  .filter(row => row.workstream === 'genuinely-unresolved-investigation')
  .map(row => row.ccn).sort();
const actualWorklistCcns = worklist.records.map(row => row.ccn).sort();
if (worklistByCcn.size !== worklist.records.length
  || JSON.stringify(actualWorklistCcns) !== JSON.stringify(expectedWorklistCcns))
  throw new Error('Investigation worklist does not exactly join the actionable reconciliation CCN set');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const worklistActionDifferenceCcns = [];
const records = [...snapshot.records].sort((a, b) => a.ccn.localeCompare(b.ccn)).map(raw => {
  const reviewed = effectiveByCcn.get(raw.ccn);
  const reconciliationRow = reconciliationByCcn.get(raw.ccn);
  const overlay = overlaysByCcn.get(raw.ccn);
  const workItem = worklistByCcn.get(raw.ccn);
  if (!reviewed || !reconciliationRow) throw new Error(`Missing exact CCN join for ${raw.ccn}`);
  if ((reconciliationRow.workstream === 'genuinely-unresolved-investigation') !== Boolean(workItem))
    throw new Error(`Investigation worklist presence disagrees with reconciliation for ${raw.ccn}`);
  if (workItem && workItem.next_action !== reconciliationRow.next_action)
    worklistActionDifferenceCcns.push(raw.ccn);
  return {
    ccn: raw.ccn,
    hospital_name: raw.hospital_name,
    state: raw.state,
    historical_891_member: members.has(raw.ccn),
    historical_891_current_category: members.has(raw.ccn) ? effectiveDispositionCategory(reviewed) : '',
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
      disposition: reviewed.disposition,
      observed_at: reviewed.observed_at,
      mrf_http_status: String(reviewed.mrf_http_status || ''),
      mrf_url: reviewed.mrf_url || '',
      standing_evidence_retained: !!reviewed.standing_evidence_retained,
      latest_observation_superseded: !!reviewed.latest_observation_superseded,
      latest_retry_observation: reviewed.latest_retry_observation || null,
      reviewed_page_file_overlay: reviewed.reviewed_page_file_overlay || '',
      overlay_root_pointer_observation: overlay?.root_pointer_observation || null,
      overlay_source_proof_file: overlay?.source_proof_file || ''
    },
    reconciliation: {
      workstream: reconciliationRow.workstream,
      status: reconciliationRow.reconciliation_status,
      issues: reconciliationRow.issues,
      latest_observed_at: reconciliationRow.latest_observed_at,
      next_action: reconciliationRow.next_action,
      actionable: !!reconciliationRow.actionable
    },
    investigation_worklist: workItem ? {
      source_file: 'unresolved-investigation-worklist.json',
      current_disposition: workItem.current_disposition,
      investigation_tier: workItem.investigation_tier,
      evidence_gate: workItem.evidence_gate,
      reviewed_follow_up: !!workItem.reviewed_follow_up,
      reviewed_sources: workItem.reviewed_sources || [],
      latest_review_at: workItem.latest_review_at || '',
      next_action: workItem.next_action,
      action_matches_reconciliation: workItem.next_action === reconciliationRow.next_action
    } : null
  };
});
const historicalUnresolved = records.filter(record => record.historical_891_member
  && record.historical_891_current_category === 'genuinely-unresolved');
const historicalUnresolvedActionDifferences = historicalUnresolved
  .filter(record => record.investigation_worklist?.action_matches_reconciliation === false)
  .map(record => record.ccn);
if (historicalUnresolved.some(record => !record.investigation_worklist))
  throw new Error('A historical 891 unresolved CCN is missing its investigation worklist row');
const counts = records.reduce((out, record) => {
  const category = effectiveDispositionCategory(effectiveByCcn.get(record.ccn));
  out.effective_category[category] = (out.effective_category[category] || 0) + 1;
  out.reconciliation_status[record.reconciliation.status] = (out.reconciliation_status[record.reconciliation.status] || 0) + 1;
  out.workstream[record.reconciliation.workstream] = (out.workstream[record.reconciliation.workstream] || 0) + 1;
  if (record.historical_891_member) {
    out.historical_891_category[record.historical_891_current_category] =
      (out.historical_891_category[record.historical_891_current_category] || 0) + 1;
  }
  return out;
}, { effective_category: {}, reconciliation_status: {}, workstream: {}, historical_891_category: {} });
const artifact = {
  generated_at: snapshot.summary.generated_at,
  purpose: 'Exact-CCN reconciliation of raw observations, validated reviewed verification overlays, nationwide reconciliation issues, prioritized investigation actions, and the frozen 2026-09-25 891-membership cohort.',
  inputs: {
    nationwide_verification: { file: 'nationwide-verification.json', sha256: digest(snapshotBytes) },
    nationwide_reconciliation: { file: 'nationwide-reconciliation.json', sha256: digest(reconciliationBytes) },
    historical_891_roster: { file: 'reconciliation-891-baseline-member-roster-2026-09-27.json', sha256: digest(rosterBytes) },
    verification_overlays: { file: 'reconciliation-nationwide-verification-overlays.json', sha256: digest(overlaysBytes) },
    unresolved_investigation_worklist: { file: 'unresolved-investigation-worklist.json', sha256: digest(worklistBytes) }
  },
  coverage: { exact_ccn_join: true, nationwide_ccns: records.length, historical_891_memberships: 891,
    historical_891_unique_ccns: members.size, historical_891_overlap_memberships: 171,
    investigation_worklist_ccns: worklist.records.length,
    investigation_worklist_exact_reconciliation_join: true,
    historical_891_unresolved_in_worklist: historicalUnresolved.length },
  investigation_worklist: {
    source_file: 'unresolved-investigation-worklist.json',
    source_sha256: digest(worklistBytes),
    actionable_items: worklist.records.length,
    historical_891_unresolved_items: historicalUnresolved.length,
    next_action_differences_from_reconciliation: worklistActionDifferenceCcns.length,
    next_action_difference_ccns: worklistActionDifferenceCcns,
    historical_891_next_action_differences: historicalUnresolvedActionDifferences.length,
    historical_891_next_action_difference_ccns: historicalUnresolvedActionDifferences
  },
  counts,
  limitations: [
    'Raw observations and effective reviewed rows are separate evidence layers; overlays are applied only after their exact-CCN source-proof validation.',
    'Reconciliation issue counts can overlap and are not additive facility counts.',
    'The 2026-09-17 all-CCN figure of 898 has no recovered exact dated member roster.'
  ],
  records
};
fs.writeFileSync(path.join(auditDir, 'nationwide-effective-audit.json'), `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ ccns: records.length, effective_categories: counts.effective_category,
  cohort_categories: counts.historical_891_category, worklist: artifact.investigation_worklist,
  output: 'data/hpt-audit/nationwide-effective-audit.json' }, null, 2));
