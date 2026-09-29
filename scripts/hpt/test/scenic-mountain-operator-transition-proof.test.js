'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../build-unresolved-investigation-worklist');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('Scenic Mountain transition resolves campus identity but not CCN continuity', () => {
  const proof = read('reconciliation-scenic-mountain-operator-transition-proof.json');
  const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/shannonhealth.com-01421c86970f.txt'));
  const verification = read('nationwide-verification.json');
  const reconciliation = read('nationwide-reconciliation.json');
  const manual = read('reconciliation-manual-access-observations.json').records.find(row => row.ccn === proof.ccn);
  const nppesProof = read('reconciliation-scenic-mountain-nppes-npi-1497606438-recheck-2026-09-28.json');
  const ownersProof = read('reconciliation-scenic-mountain-cms-all-owners-crosscheck-2026-09-29.json');
  const queued = read('unresolved-investigation-worklist.json').records.find(row => row.ccn === proof.ccn);
  const current = verification.records.find(row => row.ccn === proof.ccn);
  const review = reconciliation.records.find(row => row.ccn === proof.ccn);
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.current_pointer_sha256);
  assert.equal(current.pointer_corpus_sha256, proof.current_pointer_sha256);
  assert.equal(review.workstream, 'genuinely-unresolved-investigation');
  assert.equal(queued.current_disposition, 'current-operator-same-campus-pointer-file-ccn-continuity-unresolved');
  assert.equal(queued.nationwide_disposition, 'pointer-facility-match-unresolved');
  assert.equal(queued.evidence_gate, 'ccn-enrollment-continuity-and-complete-file');
  assert.equal(manual.latest_nppes_npi_recheck.proof_file,
    'reconciliation-scenic-mountain-nppes-npi-1497606438-recheck-2026-09-28.json');
  assert.equal(manual.latest_nppes_npi_recheck.nppes_response_sha256,
    nppesProof.source.response_sha256);
  assert.equal(nppesProof.nppes_record.dba, 'SHANNON MEDICAL CENTER BIG SPRING');
  assert.equal(nppesProof.cms_hospital_enrollments_recheck.dataset_release, '2026-08-01');
  assert.ok(nppesProof.cms_hospital_enrollments_recheck.dataset_release < nppesProof.nppes_record.last_updated,
    'the CMS enrollment snapshot predates the NPPES update and must not be read as a post-update contradiction');
  assert.equal(nppesProof.cms_hospital_enrollments_recheck.exact_npi_rows, 0);
  assert.equal(nppesProof.cms_hospital_enrollments_recheck.exact_ccn_record.npi, '1336976034');
  assert.equal(ownersProof.ccn, proof.ccn);
  assert.equal(ownersProof.exact_join.enrollment_id, 'O20250114002778');
  assert.equal(ownersProof.response_review.total_association_rows, 18);
  assert.equal(ownersProof.response_review.organization_owner_rows_retained, 8);
  assert.equal(ownersProof.response_review.individual_owner_rows_omitted_from_local_proof, 10);
  assert.equal(ownersProof.response_review.owner_association_date, '2024-09-06');
  assert.equal(ownersProof.response_review.raw_response_retained, false);
  assert.equal(ownersProof.response_review.no_shannon_organization_owner_entry, true);
  assert.ok(ownersProof.response_review.retained_organization_owner_rows.every(row =>
    row.owner_organization && !/SHANNON/i.test(row.owner_organization)));
  assert.ok(ownersProof.response_review.retained_organization_owner_rows.some(row =>
    row.owner_organization === 'QUORUM HEALTH CORPORATION'));
  assert.equal(ownersProof.cohort_count_effect, 0);
  assert.equal(manual.latest_cms_hospital_all_owners_crosscheck.proof_file,
    'reconciliation-scenic-mountain-cms-all-owners-crosscheck-2026-09-29.json');
  assert.equal(manual.latest_cms_hospital_all_owners_crosscheck.response_sha256,
    ownersProof.source.response_sha256);
  assert.equal(queued.next_action, manual.next_action);
  assert.match(queued.next_action, /post-transition CMS certification\/enrollment record/);
  assert.match(queued.next_action, /Do not repeat those unchanged snapshots/);
  assert.equal(queued.candidate_file_recorded, true);
  assert.equal(proof.complete_file_validated, false);
  const changed = structuredClone(verification);
  changed.records.find(row => row.ccn === proof.ccn).pointer_corpus_sha256 = '0'.repeat(64);
  assert.equal(build(reconciliation, changed).records.find(row => row.ccn === proof.ccn).current_disposition,
    'pointer-facility-match-unresolved');
});
