'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { effectiveDispositionCategory } = require('./build-nationwide-verification');
const { applyReviewedVerificationOverlays } = require('./lib/reviewed-verification-overlays');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const priorRef = 'da311dcdd759801eb30ff5f48ea0de6aba0f692f';
const rosterPath = path.join(audit, 'reconciliation-891-baseline-member-roster-2026-09-27.json');
const snapshotPath = path.join(audit, 'nationwide-verification.json');
const priorPath = 'data/hpt-audit/reconciliation-891-baseline-member-roster-2026-09-27.json';
const priorBytes = execFileSync('git', ['show', `${priorRef}:${priorPath}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
const currentRosterBytes = fs.readFileSync(rosterPath);
const snapshotBytes = fs.readFileSync(snapshotPath);
const prior = JSON.parse(priorBytes.toString('utf8'));
const roster = JSON.parse(currentRosterBytes.toString('utf8'));
const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
const effectiveRows = applyReviewedVerificationOverlays(snapshot.records, audit);
const effectiveByCcn = new Map(effectiveRows.map(row => [row.ccn, row]));
const worklist = JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json'), 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const categories = ['genuinely-unresolved', 'active-verification-claim', 'standing-evidence-retained',
  'superseded-by-reviewed-resolution', 'scope-exempt', 'supported-identity-uncertainty'];
const priorUnresolved = [...prior.current_crosswalk_ccns['genuinely-unresolved']].sort();
const currentUnresolved = [...roster.current_crosswalk_ccns['genuinely-unresolved']].sort();
const priorSet = new Set(priorUnresolved);
const currentSet = new Set(currentUnresolved);
const added = currentUnresolved.filter(ccn => !priorSet.has(ccn));
const removed = priorUnresolved.filter(ccn => !currentSet.has(ccn));
const worklistIds = new Set(worklist.records.map(row => row.ccn));
const missingFromWorklist = currentUnresolved.filter(ccn => !worklistIds.has(ccn));
const priorCurrentSnapshotHash = prior.current_snapshot.sha256;
const priorSnapshotBytes = execFileSync('git', ['show', `${priorRef}:data/hpt-audit/nationwide-verification.json`], {
  cwd: root, maxBuffer: 64 * 1024 * 1024
});
const priorSnapshot = JSON.parse(priorSnapshotBytes.toString('utf8'));
const priorSnapshotHash = hash(priorSnapshotBytes);
if (prior.current_snapshot.sha256 !== priorSnapshotHash)
  throw new Error(`Prior cohort checkpoint hash does not match its source commit snapshot: ${priorCurrentSnapshotHash}`);
if (new Set(priorUnresolved).size !== priorUnresolved.length || new Set(currentUnresolved).size !== currentUnresolved.length
  || roster.current_snapshot.sha256 !== hash(snapshotBytes) || effectiveByCcn.size !== 5419 || missingFromWorklist.length)
  throw new Error('Cohort delta source coverage or hash validation failed');

const priorCategories = Object.fromEntries(categories.map(category => [category,
  [...(prior.current_crosswalk_ccns[category] || [])].sort()]));
const currentCategories = Object.fromEntries(categories.map(category => [category,
  [...(roster.current_crosswalk_ccns[category] || [])].sort()]));
const transitions = [];
for (const ccn of [...new Set([...priorUnresolved, ...currentUnresolved])].sort()) {
  const row = effectiveByCcn.get(ccn);
  const currentCategory = effectiveDispositionCategory(row);
  const wasUnresolved = priorSet.has(ccn);
  const isUnresolved = currentSet.has(ccn);
  if (wasUnresolved !== isUnresolved) transitions.push({
    ccn,
    prior_category: wasUnresolved ? 'genuinely-unresolved' : 'not-genuinely-unresolved',
    current_category: currentCategory,
    direction: isUnresolved ? 'entered-unresolved' : 'left-unresolved',
    disposition: row.disposition,
    observed_at: row.observed_at,
    prior_finding: row.prior_finding || '',
    standing_evidence_retained: !!row.standing_evidence_retained,
    latest_observation_superseded: !!row.latest_observation_superseded,
    reviewed_page_file_overlay: row.reviewed_page_file_overlay || '',
    next_action: row.next_action || ''
  });
}
const output = {
  audit_id: 'reconciliation-891-category-delta-2026-09-29',
  purpose: 'Exact-CCN comparison of the committed 2026-09-27 current cohort unresolved set against the current effective reviewed categories. It does not recreate the later 539-only checkpoint whose exact set is not retained.',
  sources: {
    prior_roster: { git_ref: priorRef, path: priorPath, sha256: hash(priorBytes), snapshot_sha256: priorSnapshotHash,
      snapshot_generated_at: prior.current_snapshot.generated_at },
    current_roster: { path: path.basename(rosterPath), sha256: hash(currentRosterBytes), snapshot_sha256: hash(snapshotBytes),
      snapshot_generated_at: snapshot.summary.generated_at },
    current_snapshot: { path: path.basename(snapshotPath), sha256: hash(snapshotBytes), ccns: snapshot.records.length,
      raw_unresolved: snapshot.summary.unresolved, reviewed_unresolved: snapshot.summary.reviewed_view_unresolved }
  },
  cohort: { historical_memberships: roster.summary.category_membership_sum, unique_ccns: 720, overlaps: 171,
    previous_unresolved: priorUnresolved.length, current_unresolved: currentUnresolved.length,
    continued_unresolved: currentUnresolved.filter(ccn => priorSet.has(ccn)).length,
    newly_unresolved: added.length, no_longer_unresolved: removed.length,
    previous_counts: prior.summary.current_effective_categories, current_counts: roster.summary.current_effective_categories },
  comparison: { newly_unresolved_ccns: added, no_longer_unresolved_ccns: removed,
    transitions, previous_category_members: priorCategories, current_category_members: currentCategories },
  interpretation: 'Category movement is not automatically evidence gain or facility closure. Review each transition with its cited exact-CCN source proof and retain unresolved status when current identity, pointer, file, metadata, or usability gates remain open.',
  validation: { exact_ccn_join: true, cohort_member_union: 720, all_current_unresolved_in_worklist: missingFromWorklist.length === 0,
    missing_worklist_ccns: missingFromWorklist,
    prior_snapshot_hash_matches_committed_roster: true }
};
fs.writeFileSync(path.join(audit, 'reconciliation-891-category-delta-2026-09-29.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ prior_unresolved: priorUnresolved.length, current_unresolved: currentUnresolved.length,
  continued: output.cohort.continued_unresolved, newly_unresolved: added.length,
  no_longer_unresolved: removed.length, output: 'data/hpt-audit/reconciliation-891-category-delta-2026-09-29.json' }, null, 2));
