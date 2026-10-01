'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Siouxland acquisition evidence does not assign parent CCN or incorrect-address file to 160153', () => {
  const proof = require(path.join(audit, 'reconciliation-siouxland-transition-proof.json'));
  const observation = require(path.join(audit, 'reconciliation-manual-access-observations.json'))
    .records.find(row => row.ccn === '160153');
  assert.equal(proof.roster_address, '801 5TH ST');
  assert.equal(proof.state_directory_current_ccn, '160146');
  assert.equal(proof.state_directory_former_name, 'MERCYONE SIOUXLAND MEDICAL CENTER');
  assert.match(proof.declared_addresses, /801 15th St, Sioux City, IA 51101/);
  assert.match(proof.state_directory_address, /801 5th ST/);
  assert.equal(proof.declared_date, '2026-01-28');
  assert.equal(proof.declared_version, '3.0.0');
  assert.ok(proof.retained_bytes < proof.file_total_bytes);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(observation.disposition, 'current-cms-identity-recheck-transition-unresolved');
  assert.match(observation.next_action, /160153 unresolved|effective-dated CMS enrollment|publisher clarification/i);
  const view = loadReviewedView(audit);
  assert.notEqual(view.compliance.find(row => row.ccn === '160153').mrf_url, proof.shared_file_url);
  assert.equal(view.compliance.find(row => row.ccn === '160146').mrf_url, proof.shared_file_url);
});

test('new August 2026 CMS enrollment snapshot narrows Siouxland transition without closing the 891 case', () => {
  const proof = require(path.join(audit, 'reconciliation-siouxland-cms-hospital-enrollments-2026-08-crosscheck.json'));
  const manual = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records
    .filter(row => row.ccn === '160153').at(-1);
  const reconciliation = require(path.join(audit, 'nationwide-reconciliation.json')).records
    .find(row => row.ccn === '160153');
  const worklist = require(path.join(audit, 'unresolved-investigation-worklist.json')).records
    .find(row => row.ccn === '160153');
  const cohort = require(path.join(audit, 'reconciliation-891-baseline-member-roster-2026-09-27.json'));

  assert.equal(proof.catalog_latest_release_title, 'Hospital Enrollments : 2026-08-01');
  assert.equal(proof.cms_landing_page_displayed_latest_release_when_checked, 'May 2026');
  assert.match(proof.release_metadata_discrepancy, /catalog lists an August 1, 2026/);
  assert.equal(proof.csv.http_status, 200);
  assert.equal(proof.csv.bytes, 2516964);
  assert.match(proof.csv.sha256, /^[a-f0-9]{64}$/);
  assert.equal(proof.csv.ccn_160153_row_present, false);
  assert.equal(proof.csv.ccn_160146_row_present, true);
  assert.equal(proof.csv.matching_row['ADDRESS LINE 1'], '2720 STONE PARK BLVD');
  assert.equal(manual.cms_enrollment_snapshot?.dataset_release, 'Hospital Enrollments 2026-08-01; CSV dated 2026-07-31');
  assert.equal(manual.qies_pos_q1_2026_transition_crosscheck.proof_file,
    'reconciliation-siouxland-qies-pos-2026-q1-transition-crosscheck.json');
  assert.equal(manual.disposition, 'cms-qies-confirms-dated-voluntary-merger-closure-and-successor-cross-reference-historical-hpt-scope-unresolved');
  assert.match(reconciliation.next_action, /historical pre-2025-08-31/);
  assert.equal(reconciliation.actionable, true);
  assert.ok(worklist, 'legacy CCN remains in the unresolved worklist');
  assert.ok(cohort.current_crosswalk_ccns['genuinely-unresolved'].includes('160153'));
  assert.equal(cohort.summary.baseline_unresolved_still_unresolved, 541);
});

test('Q1 2026 CMS QIES confirms dated Siouxland merger transition without closing historical HPT case', () => {
  const proof = require(path.join(audit, 'reconciliation-siouxland-qies-pos-2026-q1-transition-crosscheck.json'));
  const manual = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records
    .find(row => row.ccn === '160153');
  const cohort = require(path.join(audit, 'reconciliation-891-baseline-member-roster-2026-09-27.json'));
  assert.equal(proof.dataset_release, 'Q1 2026');
  assert.match(proof.dictionary_field_meanings.PGM_TRMNTN_CD, /01 = VOLUNTARY-MERGER, CLOSURE/);
  assert.match(proof.dictionary_field_meanings.TRMNTN_EXPRTN_DT, /Date the provider was terminated/);
  assert.equal(proof.queries[0].selected_row.TRMNTN_EXPRTN_DT, '20250831');
  assert.equal(proof.queries[0].selected_row.PGM_TRMNTN_CD, '01');
  assert.equal(proof.queries[0].selected_row.CROSS_REF_PROVIDER_NUMBER, '160146');
  assert.equal(proof.queries[1].selected_row.PGM_TRMNTN_CD, '00');
  assert.equal(proof.queries[1].selected_row.CHOW_DT, '20250901');
  assert.equal(proof.cohort_unresolved_change, 0);
  const nested = require(path.join(audit, 'nationwide-reconciliation.json')).records
    .find(row => row.ccn === '160153').manual_access_observation;
  assert.equal(nested.qies_pos_q1_2026_transition_crosscheck.provider_termination_date, '2025-08-31');
  assert.equal(nested.disposition, 'cms-qies-confirms-dated-voluntary-merger-closure-and-successor-cross-reference-historical-hpt-scope-unresolved');
  assert.ok(cohort.current_crosswalk_ccns['genuinely-unresolved'].includes('160153'));
  assert.equal(cohort.summary.baseline_unresolved_still_unresolved, 541);
});
