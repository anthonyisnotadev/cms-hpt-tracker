'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-neshoba-ccn-transition-proof.json')));

test('Neshoba shared campus retains separate acute and critical-access CCN work', () => {
  const pointer = fs.readFileSync(path.join(root, proof.retained_pointer.cached_file));
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.retained_pointer.cached_sha256);
  assert.match(pointer.toString('utf8'), /^location-name: Neshoba County General Hospital/m);
  assert.ok(pointer.toString('utf8').includes(proof.retained_pointer.mrf_url));
  assert.equal(proof.current_file.declared_address, '1001 Holland Ave Philadelphia MS 39350');
  assert.equal(proof.current_file.declared_license_state_field, 'MS');
  assert.deepEqual(proof.ccns, ['250043', '251340']);
  const observations = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'))).records;
  const unresolved = JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json'))).records;
  const standing = JSON.parse(fs.readFileSync(path.join(audit, 'standing-evidence-followup-worklist.json'))).records;
  for (const ccn of proof.ccns) {
    const observation = observations.find(row => row.ccn === ccn);
    if (ccn === '250043') {
      assert.equal(observation.proof_file, 'reconciliation-neshoba-current-domain-recheck-proof-2026-09-21.json');
    } else {
      assert.equal(observation.proof_file, 'reconciliation-neshoba-ccn-transition-proof.json');
      assert.equal(observation.complete_file_sha256, proof.current_file.complete_sha256);
    }
    const work = (ccn === '250043' ? unresolved : standing).find(row => row.ccn === ccn);
    assert.equal(work.reviewed_follow_up, true);
    if (ccn === '250043') {
      assert.match(work.next_action, /pre-2025-12-31 pointer\/MRF evidence/);
      assert.match(work.next_action, /historical accountability baseline/);
    } else {
      assert.match(work.next_action, /current root pointer|publisher confirmation/);
      assert.match(work.next_action, /251340/);
    }
  }
});

test('Neshoba secondary September label does not replace the retained June 4 publisher-declared file', () => {
  const secondary = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-neshoba-third-party-date-raw-link-recheck-2026-09-27.json')));
  assert.deepEqual(secondary.ccns, ['250043', '251340']);
  assert.match(secondary.secondary_discovery_source.page_claim, /updated 2026-09-01/);
  assert.equal(secondary.bounded_raw_file_retrieval.http_status, 200);
  assert.equal(secondary.bounded_raw_file_retrieval.bytes, proof.current_file.complete_bytes);
  assert.equal(secondary.bounded_raw_file_retrieval.sha256, proof.current_file.complete_sha256);
  assert.equal(secondary.bounded_raw_file_retrieval.declared_last_updated_on, '2026-06-04');
  assert.equal(secondary.disposition_effect, 'none; retain both CCN records and the existing shared-campus uncertainty');
  const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'))).records;
  const qies = manual.find(row => row.ccn === '250043' && row.proof_file === 'reconciliation-neshoba-cms-pos-transition-proof-2026-09-27.json');
  assert.equal(qies.latest_secondary_raw_file_recheck_2026_09_27.raw_download_sha256, proof.current_file.complete_sha256);
  assert.equal(qies.latest_secondary_raw_file_recheck_2026_09_27.disposition_effect, 'none');
});

test('Neshoba current transition actions separate retired acute CCN from active CAH and retain the QIES query discrepancy', () => {
  const transition = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-neshoba-cms-pos-transition-proof-2026-09-27.json')));
  const review = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-neshoba-qies-query-discrepancy-and-operator-page-recheck-2026-09-27.json')));
  const census = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-qies-unresolved-status-audit-2026-09-27.json')));
  const header = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-reviewed-header-dispositions.json'))).records;
  assert.equal(review.qies_query_result_discrepancy.bulk_query_sha256, census.source_response_sha256);
  assert.ok(census.cohort.no_exact_row_ccns.includes('250043'));
  const acute = transition.cms_rows.find(row => row.ccn === '250043');
  const cah = transition.cms_rows.find(row => row.ccn === '251340');
  assert.deepEqual([acute.termination_code, acute.termination_or_expiration_date], ['07', '20251231']);
  assert.deepEqual([cah.provider_subtype_code, cah.termination_code, cah.original_participation_date], ['11', '00', '20260101']);
  assert.equal(review.qies_query_result_discrepancy.exact_ccn_query_recorded_row.ccn, '250043');
  assert.equal(review.qies_query_result_discrepancy.original_exact_query_body_sha256, null);
  assert.match(review.qies_query_result_discrepancy.original_exact_query_hash_status, /fresh exact-filter response hashes/);
  const hashedRecheck = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-neshoba-qies-hashed-query-recheck-2026-09-27.json')));
  assert.equal(review.qies_query_result_discrepancy.latest_hashed_recheck.proof_file,
    'reconciliation-neshoba-qies-hashed-query-recheck-2026-09-27.json');
  assert.equal(review.qies_query_result_discrepancy.latest_hashed_recheck.bulk_sha256_matches_previous, true);
  assert.equal(review.qies_query_result_discrepancy.latest_hashed_recheck.bulk_omits_both_exact_query_ccns, true);
  assert.deepEqual(hashedRecheck.exact_ccn_queries.map(row => row.record_fields.PRVDR_NUM), ['250043', '251340']);
  assert.deepEqual(hashedRecheck.exact_ccn_queries.map(row => row.response_sha256), [
    '5a895362d792efdcd3e7fa6fd496822e2d111a507f21c052941f8ba5723968b5',
    'e33aecd0338e05e0e7ec13224b269ac024506aea9c72f21b6d2570940c92b91c'
  ]);
  assert.equal(hashedRecheck.same_version_bulk_query.response_sha256,
    review.qies_query_result_discrepancy.bulk_query_sha256);
  assert.equal(review.disposition_effect, 'none');
  assert.equal(review.unresolved_count_change, 0);
  const oldCcn = header.find(row => row.ccn === '250043');
  const activeCcn = header.find(row => row.ccn === '251340');
  const workItem = JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json')))
    .records.find(row => row.ccn === '250043');
  assert.equal(oldCcn.proof_file, 'reconciliation-neshoba-qies-query-discrepancy-and-operator-page-recheck-2026-09-27.json');
  assert.equal(oldCcn.disposition, 'historical-acute-ccn-hpt-coverage-unresolved');
  assert.match(oldCcn.next_action, /pre-2025-12-31/);
  assert.equal(workItem.current_disposition, oldCcn.disposition);
  assert.equal(workItem.nationwide_disposition, 'mrf-facility-identity-unresolved');
  assert.equal(workItem.evidence_gate, 'historical-hpt-coverage-through-2025-12-31');
  assert.equal(workItem.next_action, oldCcn.next_action);
  assert.equal(activeCcn.disposition, 'current-cah-shared-campus-mrf-ccn-scope-unresolved');
  assert.match(activeCcn.next_action, /251340/);
  assert.equal(review.official_operator_sources.critical_access_accreditation_certificate.facility,
    'Neshoba County General Hospital, 1001 Holland Avenue, Philadelphia, MS 39350-2161');
});
