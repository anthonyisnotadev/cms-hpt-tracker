'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('Westwood-Pembroke state and CHIA evidence do not resolve or merge the two CCNs', () => {
  const proof = read('reconciliation-westwood-pembroke-chia-profile-proof-2026-09-28.json');
  const licenseSearch = read('reconciliation-westwood-pembroke-dmh-license-listing-search-2026-09-28.json');
  const hrsa = read('reconciliation-westwood-pembroke-hrsa-donor-hospital-crosscheck-2026-09-28.json');
  const manual = read('reconciliation-manual-access-observations.json').records.find(row => row.ccn === '224023');
  const worklist = read('unresolved-investigation-worklist.json').records.find(row => row.ccn === '224023');
  const roster = read('reconciliation-891-baseline-member-roster-2026-09-27.json');

  assert.equal(proof.ccn, '224023');
  assert.equal(proof.sibling_ccn, '224013');
  assert.equal(proof.source.report_sha256, '606032b97cb76b5ddbc8394bb0ce8a06fdb6159e221947084d9677cc21c525f');
  assert.equal(proof.observations.combined_report_name, 'Westwood Lodge Pembroke Hospital');
  assert.equal(proof.observations.hfy2024_inpatient_days, 36138);
  assert.match(proof.observations.scope_limit, /does not identify which campus or CCN/);
  assert.match(proof.disposition_effect, /retain 224023 unresolved/);

  assert.equal(licenseSearch.ccn, '224023');
  assert.equal(licenseSearch.recorded_facility.license_number, '1039');
  assert.equal(licenseSearch.recorded_facility.displayed_license_expiration, '2017-06-19');
  assert.match(licenseSearch.retrieval_method, /HTTP 403/);
  assert.match(licenseSearch.interpretation, /unusable as evidence of current licensure/);
  assert.match(licenseSearch.disposition_effect, /remains unresolved/);

  assert.equal(hrsa.ccn, '224023');
  assert.equal(hrsa.source_record.identifier, '224023-NMB');
  assert.equal(hrsa.source_record.cohort_begin, '2024-03-01');
  assert.equal(hrsa.source_record.cohort_end, '2025-02-28');
  assert.match(hrsa.interpretation, /not a CMS enrollment\/termination record/);
  assert.match(hrsa.disposition_effect, /none/);

  assert.equal(manual.current_chia_profile_review_2026_09_28.proof_file,
    'reconciliation-westwood-pembroke-chia-profile-proof-2026-09-28.json');
  assert.equal(manual.latest_dmh_license_listing_search_2026_09_28.proof_file,
    'reconciliation-westwood-pembroke-dmh-license-listing-search-2026-09-28.json');
  assert.equal(manual.latest_hrsa_donor_hospital_crosscheck_2026_09_28.proof_file,
    'reconciliation-westwood-pembroke-hrsa-donor-hospital-crosscheck-2026-09-28.json');
  assert.equal(worklist.current_disposition, 'official-website-not-identified-completed-search');
  assert.equal(worklist.candidate_file_recorded, false);
  assert.match(manual.next_action, /separating Westwood Lodge from Pembroke Hospital CCN 224013/);
  assert.match(worklist.next_action, /separating Westwood Lodge from Pembroke Hospital CCN 224013/);
  assert.ok(worklist.next_action.includes('license 1039'));
  assert.match(worklist.next_action, /224023-NMB/);
  assert.ok(Date.parse(worklist.latest_review_at) >= Date.parse(licenseSearch.observed_at));
  assert.ok(roster.baseline_unresolved_ccns.includes('224023'));
});
