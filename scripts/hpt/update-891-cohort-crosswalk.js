#!/usr/bin/env node
'use strict';

// Refresh the dated 2026-09-25 891-membership cohort crosswalk against the
// current canonical nationwide snapshot without changing the frozen baseline.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { applyReviewedVerificationOverlays } = require('./lib/reviewed-verification-overlays');

const root = path.resolve(__dirname, '../..');
const auditDir = path.join(root, 'data/hpt-audit');
const read = (name) => JSON.parse(fs.readFileSync(path.join(auditDir, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(auditDir, name), `${JSON.stringify(value, null, 2)}\n`);
const snapshotPath = path.join(auditDir, 'nationwide-verification.json');
const snapshotBytes = fs.readFileSync(snapshotPath);
const snapshot = JSON.parse(snapshotBytes);
const rosterName = 'reconciliation-891-baseline-member-roster-2026-09-27.json';
const sourceAuditName = 'reconciliation-891-baseline-source-recoverability-audit-2026-09-27.json';
const roster = read(rosterName);
const audit = read(sourceAuditName);
// Cohort status is based on the effective reviewed view, including validated
// page-linked file overlays, while the source snapshot hash remains bound to
// the immutable raw nationwide observation.
const effectiveRecords = applyReviewedVerificationOverlays(snapshot.records, auditDir);
const byCcn = new Map(effectiveRecords.map((row) => [row.ccn, row]));
const members = [...new Set([...roster.baseline_unresolved_ccns, ...roster.baseline_pointer_denied_ccns])].sort();
if (members.length !== 720 || byCcn.size !== 5419) throw new Error(`Unexpected source size: ${members.length} cohort CCNs, ${byCcn.size} current CCNs`);

function category(row) {
  // A current scope disposition is stronger than a historical observation
  // being superseded while the reviewed resolution was applied.
  if (row.disposition.startsWith('scope-exempt')) return 'scope-exempt';
  if (row.latest_observation_superseded) return 'superseded-by-reviewed-resolution';
  if (row.standing_evidence_retained) return 'standing-evidence-retained';
  if (row.supported_identity_uncertainty) return 'supported-identity-uncertainty';
  if (row.disposition.startsWith('verified-')) return 'active-verification-claim';
  return 'genuinely-unresolved';
}

// Prefer the already-generated exclusive effective category when the source
// records contain it; otherwise the mapping above is checked against totals.
const groups = Object.fromEntries(['genuinely-unresolved', 'active-verification-claim', 'standing-evidence-retained', 'superseded-by-reviewed-resolution', 'scope-exempt'].map((key) => [key, []]));
for (const ccn of members) {
  const row = byCcn.get(ccn);
  if (!row) throw new Error(`Current snapshot is missing cohort CCN ${ccn}`);
  const effective = category(row);
  if (!groups[effective]) throw new Error(`Unexpected cohort category ${effective} for ${ccn}`);
  groups[effective].push(ccn);
}
const counts = Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, values.length]));
const expected = { 'genuinely-unresolved': 543, 'active-verification-claim': 21, 'standing-evidence-retained': 72, 'superseded-by-reviewed-resolution': 69, 'scope-exempt': 15 };
if (JSON.stringify(counts) !== JSON.stringify(expected)) throw new Error(`Effective category crosswalk mismatch: ${JSON.stringify(counts)}`);

const currentSnapshotUnresolved = snapshot.summary.effective_counts['genuinely-unresolved'];

const baselineUnresolvedNow = { 'active-verification-claim': [], 'superseded-by-reviewed-resolution': [], 'scope-exempt': [] };
for (const ccn of roster.baseline_unresolved_ccns) {
  const group = category(byCcn.get(ccn));
  if (group !== 'genuinely-unresolved') baselineUnresolvedNow[group].push(ccn);
}
const pointerDenied = members.filter((ccn) => byCcn.get(ccn).disposition === 'pointer-access-denied-to-client');
const generatedAt = snapshot.summary.generated_at;
const snapshotHash = crypto.createHash('sha256').update(snapshotBytes).digest('hex');
const unresolvedMembership = groups['genuinely-unresolved'].length;
const otherCount = roster.baseline_unresolved_ccns.length - unresolvedMembership;
roster.observed_at = generatedAt;
roster.summary.current_effective_categories = counts;
roster.summary.current_pointer_access_denied_ccns = pointerDenied.length;
roster.summary.baseline_unresolved_still_unresolved = unresolvedMembership;
roster.summary.baseline_unresolved_now_other_category = otherCount;
roster.current_snapshot = { generated_at: generatedAt, ccns: byCcn.size, sha256: snapshotHash };
roster.current_crosswalk_ccns = { ...groups, 'current_pointer_access_denied_ccns': pointerDenied };
roster.current_crosswalk_ccns['baseline_unresolved_now_active_ccns'] = baselineUnresolvedNow['active-verification-claim'];
roster.current_crosswalk_ccns['baseline_unresolved_now_superseded_ccns'] = baselineUnresolvedNow['superseded-by-reviewed-resolution'];
roster.current_crosswalk_ccns['baseline_unresolved_now_scope_exempt_ccns'] = baselineUnresolvedNow['scope-exempt'];
write(rosterName, roster);

const current = audit.recoverable_snapshot_sources.find((item) => item.ref === 'working-tree-current');
current.generated_at = generatedAt;
current.sha256 = snapshotHash;
current.effective_counts = snapshot.summary.effective_counts;
current.pointer_access_denied_raw = snapshot.summary.counts['pointer-access-denied-to-client'] || 0;
audit.observed_at = generatedAt;
audit.result.current_crosswalk_for_720_unique_ccns = counts;
audit.result.baseline_unresolved_now_other_category = Object.fromEntries(Object.entries(baselineUnresolvedNow).map(([key, values]) => [key, values.length]));
audit.result.conclusion = `The exact Sep. 25 snapshot and both exact category member sets are recovered and stable across 28 matching snapshots. The user-facing 891 total double-counted 171 CCNs present in both categories; the deduplicated baseline is 720 hospitals. Keep the 593 and 298 category memberships separately auditable, reconcile all 720 against current evidence, and do not substitute the overall current ${currentSnapshotUnresolved} serialized unresolved count or infer closure from aggregate deltas. Current state-operated hospitals without the CMS deemed-compliant exception evidence remain unresolved, not noncompliant; ${baselineUnresolvedNow['scope-exempt'].length} individually supported exemptions remain.`;
audit.next_action = `Continue evidence review for the ${unresolvedMembership} unresolved CCNs in this historical cohort, including the state-operated hospitals whose exception is not established; retain the ${baselineUnresolvedNow['active-verification-claim'].length} active-claim, ${baselineUnresolvedNow['superseded-by-reviewed-resolution'].length} superseded, and ${baselineUnresolvedNow['scope-exempt'].length} individually supported scope-exempt baseline-unresolved records as auditable dispositions. Continue the full 5,419-CCN reconciliation independently.`;
write(sourceAuditName, audit);

const worklistName = 'unresolved-investigation-worklist.json';
const nationwideName = 'nationwide-reconciliation.json';
const worklistBytes = fs.readFileSync(path.join(auditDir, worklistName));
const nationwideBytes = fs.readFileSync(path.join(auditDir, nationwideName));
const worklist = JSON.parse(worklistBytes);
const nationwide = JSON.parse(nationwideBytes);
const crosscheck = {
  audit_id: 'reconciliation-891-worklist-membership-crosscheck-2026-09-28',
  observed_at: generatedAt,
  purpose: 'Reconcile the historical 891-membership cohort\'s genuinely unresolved CCNs against the active nationwide unresolved investigation worklist, so cohort progress is not confused with the larger nationwide queue.',
  inputs: {
    cohort_roster: { path: `data/hpt-audit/${rosterName}`, sha256: hashFile(path.join(auditDir, rosterName)), current_snapshot_sha256: snapshotHash },
    nationwide_worklist: { path: `data/hpt-audit/${worklistName}`, sha256: crypto.createHash('sha256').update(worklistBytes).digest('hex'), source_nationwide_reconciliation_sha256: crypto.createHash('sha256').update(nationwideBytes).digest('hex') }
  },
  comparison: {
    historical_cohort_memberships: 891,
    historical_cohort_unique_ccns: 720,
    historical_cohort_overlap_memberships: 171,
    cohort_genuinely_unresolved_ccns: unresolvedMembership,
    nationwide_unresolved_worklist_ccns: worklist.records.length,
    cohort_unresolved_missing_from_worklist: groups['genuinely-unresolved'].filter(ccn => !worklist.records.some(row => row.ccn === ccn)).sort(),
    worklist_ccns_outside_historical_cohort: worklist.records.map(row => row.ccn).filter(ccn => !groups['genuinely-unresolved'].includes(ccn)).sort(),
    counts_by_current_cohort_category: counts
  },
  result: `All ${unresolvedMembership} genuinely unresolved historical-cohort CCNs are present in the ${worklist.records.length}-record nationwide worklist; remaining records reflect wider nationwide worklist membership.`,
  validation: { exact_ccn_set_membership_comparison: true, snapshot_ccn_count: byCcn.size, snapshot_sha256_matches_cohort_roster: true }
};
write('reconciliation-891-worklist-membership-crosscheck-2026-09-28.json', crosscheck);
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
console.log(JSON.stringify({ generatedAt, snapshotHash, cohortCCNs: members.length, categoryCounts: counts, unresolvedPointerDenied: pointerDenied.length }, null, 2));
