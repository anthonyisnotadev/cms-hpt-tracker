'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { applyReviewedVerificationOverlays } = require('../lib/reviewed-verification-overlays');

const root = path.resolve(__dirname, '../../..');
const auditPath = path.join(root, 'data/hpt-audit/reconciliation-891-baseline-source-recoverability-audit-2026-09-27.json');
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const rosterPath = path.join(root, 'data/hpt-audit/reconciliation-891-baseline-member-roster-2026-09-27.json');
const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
const relative = 'data/hpt-audit/nationwide-verification.json';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const membershipHash = ccns => hash(Buffer.from([...ccns].sort().join(',')));

test('historical 891 baseline audit binds available snapshots without inventing members', () => {
  assert.equal(593 + 298, 891);
  assert.equal(audit.result.exact_sep_25_snapshot_found, true);
  assert.equal(audit.result.exact_891_member_ccn_roster_found, false);
  assert.equal(audit.result.exact_category_membership_roster_found, true);
  assert.equal(audit.result.unique_sep_25_ccns, 720);
  assert.equal(audit.result.overlap_ccns, 171);
  assert.equal(audit.result.closure_credit_awarded, 0);
  for (const snapshot of audit.recoverable_snapshot_sources) {
    let bytes;
    if (snapshot.ref === 'working-tree-current') bytes = fs.readFileSync(path.join(root, relative));
    else bytes = execFileSync('git', ['show', `${snapshot.ref}:${relative}`], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024
    });
    if (snapshot.ref !== 'working-tree-current') assert.equal(hash(bytes), snapshot.sha256, `snapshot hash for ${snapshot.ref}`);
    const data = JSON.parse(bytes.toString('utf8'));
    assert.equal(data.records.length, 5419);
    assert.equal(data.summary.generated_at, snapshot.generated_at);
    assert.deepEqual(data.summary.effective_counts, snapshot.effective_counts);
    assert.equal(data.summary.counts['pointer-access-denied-to-client'], snapshot.pointer_access_denied_raw);
  }
  const report = fs.readFileSync(path.join(root, audit.other_dated_report.path), 'utf8');
  assert.equal(hash(Buffer.from(report)), audit.other_dated_report.sha256);
  assert.match(report, /Historical snapshot: 2026-09-15/);
  assert.match(report, /not the current tracker totals/);
  assert.match(report, /\[current nationwide snapshot\]\(nationwide-verification\.json\)/);
  assert.match(report, /Generated from the reconciled local evidence snapshot on 2026-09-15/);
  assert.match(report, /\| Genuinely unresolved latest assessment \| 1,100 \|/);
  assert.match(report, /`pointer-access-denied-to-client` \| 296 \|/);
  assert.match(audit.result.conclusion, /do not substitute the overall current \d+ serialized unresolved count/);
});

test('recovered Sep. 25 roster binds both overlapping category memberships and deduplicates CCNs', () => {
  const unresolved = new Set(roster.baseline_unresolved_ccns);
  const denied = new Set(roster.baseline_pointer_denied_ccns);
  const union = new Set([...unresolved, ...denied]);
  const overlap = [...unresolved].filter(ccn => denied.has(ccn));
  assert.equal(roster.source_snapshot.generated_at, '2026-09-25T14:28:24.129Z');
  assert.equal(roster.source_snapshot.ccns, 5419);
  assert.equal(roster.baseline_unresolved_ccns.length, 593);
  assert.equal(roster.baseline_pointer_denied_ccns.length, 298);
  assert.equal(overlap.length, 171);
  assert.equal(union.size, 720);
  assert.equal(roster.summary.category_membership_sum, 891);
  assert.equal(roster.summary.unique_ccns, 720);
  assert.equal(membershipHash(unresolved), roster.matching_snapshot_validation.unresolved_membership_sha256);
  assert.equal(membershipHash(denied), roster.matching_snapshot_validation.pointer_denied_membership_sha256);
  assert.equal(membershipHash(union), roster.matching_snapshot_validation.union_membership_sha256);
  assert.equal(roster.matching_snapshot_validation.matching_snapshots, 28);
  assert.equal(roster.matching_snapshot_validation.all_category_memberships_identical, true);
  const effectiveCategories = {
    'genuinely-unresolved': 543,
    'active-verification-claim': 21,
    'standing-evidence-retained': 72,
    'superseded-by-reviewed-resolution': 69,
    'scope-exempt': 15
  };
  const currentCategories = roster.current_crosswalk_ccns;
  const currentUnion = new Set(Object.entries(currentCategories)
    .filter(([category]) => category !== 'current_pointer_access_denied_ccns'
      && !category.startsWith('baseline_unresolved_now_'))
    .flatMap(([, ccns]) => ccns));
  assert.equal(currentUnion.size, 720);
  assert.deepEqual(Object.fromEntries(Object.keys(effectiveCategories)
    .map(category => [category, currentCategories[category].length])), effectiveCategories);
  assert.equal(currentCategories.current_pointer_access_denied_ccns.length, 229);
  assert.deepEqual(currentCategories['scope-exempt'], ['021309', '030071', '030074', '030084', '030113', '030195', '031307', '031308', '031309', '241358', '340156', '370170', '370171', '370173', '370244']);
  assert.equal(currentCategories.baseline_unresolved_now_active_ccns.length, 19);
  assert.equal(currentCategories.baseline_unresolved_now_superseded_ccns.length, 16);
  assert.deepEqual(currentCategories.baseline_unresolved_now_scope_exempt_ccns,
    ['021309', '030071', '030074', '030084', '030113', '030195', '031307', '031308', '031309', '241358', '340156', '370170', '370171', '370173', '370244']);
  assert.equal(roster.summary.baseline_unresolved_still_unresolved, 543);
  const pendingScopeReviews = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reviewed-resolutions.json'), 'utf8'))
    .filter(item => item.action === 'scope-review-pending');
  assert.equal(pendingScopeReviews.length, 13);
  assert.ok(pendingScopeReviews.every(item => item.previous_action === 'exempt-state-hospital'
    && item.scope_review?.status === 'state-hospital-exception-not-established'
    && /not a noncompliance finding/.test(item.note)
    && item.scope_review.cms_guidance_url === 'https://www.cms.gov/files/document/hospital-price-transparency-frequently-asked-questions.pdf'));
  const texasProof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-texas-state-hospital-scope-proof-2026-09-27.json'), 'utf8'));
  assert.equal(texasProof.facility_dispositions.filter(item => item.ccn.startsWith('454')).length, 8);
  assert.match(texasProof.rio_grande_address_discrepancy, /78552.*78550|78550.*78552/);
  assert.match(texasProof.rio_grande_rate_schedule_source, /2025-ffy-psych-hosp-perdiem\.pdf/);
  assert.match(texasProof.no_pricing_claim, /No pointer URL, MRF URL, bytes/);
  const marylandProof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-maryland-state-hospital-scope-proof-2026-09-27.json'), 'utf8'));
  assert.deepEqual(marylandProof.facility_dispositions.map(item => item.ccn), ['214002', '214004', '214012', '214018']);
  assert.equal(marylandProof.cms_enrollment_dataset.records.length, 4);
  assert.ok(marylandProof.cms_enrollment_dataset.records.every(item => item.row_count === 1
    && /^[a-f0-9]{64}$/.test(item.response_sha256)
    && item.organization_name === 'COMPTROLLER OF MARYLAND CENTRAL PAYROLL BUREAU'));
  assert.match(marylandProof.no_pricing_claim, /No pointer URL, MRF URL, file bytes/);

  let sourceBytes;
  try {
    sourceBytes = execFileSync('git', ['cat-file', 'blob', roster.source_snapshot.git_blob_sha1], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  } catch {
    // The standalone member lists remain auditable if a future clone omits this unreachable Git object.
  }
  if (sourceBytes) {
    assert.equal(hash(sourceBytes), roster.source_snapshot.sha256);
    const source = JSON.parse(sourceBytes.toString('utf8'));
    assert.equal(source.summary.effective_counts['genuinely-unresolved'], 593);
    assert.equal(source.summary.counts['pointer-access-denied-to-client'], 298);
    assert.deepEqual(source.records.filter(record => !record.latest_observation_superseded
      && !record.standing_evidence_retained && !record.supported_identity_uncertainty
      && !/^verified-|^scope-exempt/.test(record.disposition)).map(record => record.ccn).sort(), [...unresolved].sort());
    assert.deepEqual(source.records.filter(record => record.disposition === 'pointer-access-denied-to-client')
      .map(record => record.ccn).sort(), [...denied].sort());
  }

  const currentPath = path.join(root, relative);
  const currentBytes = fs.readFileSync(currentPath);
  if (hash(currentBytes) === roster.current_snapshot.sha256) {
    const current = JSON.parse(currentBytes.toString('utf8'));
    const reviewedRecords = applyReviewedVerificationOverlays(current.records, path.join(root, 'data/hpt-audit'));
    const currentByCcn = new Map(reviewedRecords.map(record => [record.ccn, record]));
    const effectiveCategory = record => /^scope-exempt/.test(record.disposition) ? 'scope-exempt'
      : record.latest_observation_superseded ? 'superseded-by-reviewed-resolution'
      : record.standing_evidence_retained ? 'standing-evidence-retained'
        : record.supported_identity_uncertainty ? 'supported-identity-uncertainty'
          : /^verified-/.test(record.disposition) ? 'active-verification-claim'
            : /^scope-exempt/.test(record.disposition) ? 'scope-exempt' : 'genuinely-unresolved';
    const counts = {};
    for (const ccn of union) {
      const category = effectiveCategory(currentByCcn.get(ccn));
      counts[category] = (counts[category] || 0) + 1;
    }
    assert.deepEqual(counts, roster.summary.current_effective_categories);
    for (const [category, ccns] of Object.entries(currentCategories)) {
      if (category.startsWith('baseline_unresolved_now_')) continue;
      const expected = category === 'current_pointer_access_denied_ccns'
        ? [...union].filter(ccn => currentByCcn.get(ccn).disposition === 'pointer-access-denied-to-client').sort()
        : [...union].filter(ccn => effectiveCategory(currentByCcn.get(ccn)) === category).sort();
      assert.deepEqual(ccns, expected, `current crosswalk membership for ${category}`);
    }
    assert.deepEqual(currentCategories.baseline_unresolved_now_active_ccns,
      [...unresolved].filter(ccn => effectiveCategory(currentByCcn.get(ccn)) === 'active-verification-claim').sort());
    assert.deepEqual(currentCategories.baseline_unresolved_now_superseded_ccns,
      [...unresolved].filter(ccn => effectiveCategory(currentByCcn.get(ccn)) === 'superseded-by-reviewed-resolution').sort());
  }
});

test('891 unresolved cohort members are all represented in the hash-bound nationwide worklist', () => {
  const crosscheckPath = path.join(root, 'data/hpt-audit/reconciliation-891-worklist-membership-crosscheck-2026-09-28.json');
  const crosscheck = JSON.parse(fs.readFileSync(crosscheckPath, 'utf8'));
  const worklistPath = path.join(root, 'data/hpt-audit/unresolved-investigation-worklist.json');
  const worklist = JSON.parse(fs.readFileSync(worklistPath, 'utf8'));
  const cohortUnresolved = new Set(roster.current_crosswalk_ccns['genuinely-unresolved']);
  const worklistCcns = new Set(worklist.records.map(record => record.ccn));
  const missingFromWorklist = [...cohortUnresolved].filter(ccn => !worklistCcns.has(ccn)).sort();
  const outsideCohort = [...worklistCcns].filter(ccn => !cohortUnresolved.has(ccn)).sort();

  assert.equal(hash(fs.readFileSync(rosterPath)), crosscheck.inputs.cohort_roster.sha256);
  assert.equal(hash(fs.readFileSync(worklistPath)), crosscheck.inputs.nationwide_worklist.sha256);
  assert.equal(cohortUnresolved.size, crosscheck.comparison.cohort_genuinely_unresolved_ccns);
  assert.equal(worklistCcns.size, crosscheck.comparison.nationwide_unresolved_worklist_ccns);
  assert.deepEqual(missingFromWorklist, crosscheck.comparison.cohort_unresolved_missing_from_worklist);
  assert.deepEqual(outsideCohort, crosscheck.comparison.worklist_ccns_outside_historical_cohort);
  assert.deepEqual(outsideCohort, ['244015']);
  assert.equal(crosscheck.comparison.historical_cohort_memberships, 891);
  assert.equal(crosscheck.comparison.historical_cohort_unique_ccns, 720);
  assert.equal(crosscheck.comparison.historical_cohort_overlap_memberships, 171);
  assert.equal(crosscheck.inputs.cohort_roster.current_snapshot_sha256, roster.current_snapshot.sha256);
  assert.equal(crosscheck.inputs.cohort_roster.current_snapshot_sha256, worklist.source_sha256['nationwide-verification.json']);
});
