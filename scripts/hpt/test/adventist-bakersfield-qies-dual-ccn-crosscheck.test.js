'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-adventist-bakersfield-qies-dual-ccn-crosscheck-2026-09-29.json'), 'utf8'));
const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
const worklist = JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'))
  .records.find(row => row.ccn === '050455');

test('QIES distinguishes the two Bakersfield CCNs without assigning their shared MRF', () => {
  assert.equal(proof.records.length, 2);
  const [main, specialty] = proof.records;
  assert.equal(main.ccn, '050455');
  assert.equal(main.facility_name, 'ADVENTIST HEALTH BAKERSFIELD');
  assert.match(main.address, /2615 CHESTER AVENUE/);
  assert.equal(main.termination_code, '00');
  assert.equal(main.certified_beds, 247);
  assert.equal(specialty.ccn, '050724');
  assert.equal(specialty.facility_name, 'BAKERSFIELD HEART HOSPITAL');
  assert.match(specialty.address, /3001 SILLECT AVENUE/);
  assert.equal(specialty.termination_code, '00');
  assert.equal(specialty.certified_beds, 47);
  for (const row of proof.records) {
    assert.equal(row.http_status, 200);
    assert.equal(row.result_count, 1);
    assert.match(row.response_sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(proof.new_mrf_bytes, false);
  assert.equal(proof.disposition_changed, false);
  assert.match(proof.next_action, /Do not repeat these exact QIES queries/);
  assert.equal(proof.observed_at, '2026-09-29T05:30:14Z');
  assert.equal(proof.original_recorded_observed_at, '2026-09-29T13:15:00Z');
  assert.match(proof.timestamp_integrity_review.original_recorded_timestamp_status, /future-dated/);
  assert.equal(proof.timestamp_integrity_review.current_source_retrieval_status.includes('matched the retained UTF-8 byte counts and SHA-256 hashes exactly'), true);

  const unresolved = verification.records.find(row => row.ccn === '050455');
  const queued = worklist.records.find(row => row.ccn === '050455');
  assert.equal(unresolved.pointer_state, 'retrieved-facility-match-unresolved');
  assert.match(queued.next_action, /corrected first-party pointer\/file or authoritative publisher documentation/);
  assert.equal(manual.latest_qies_dual_ccn_crosscheck_2026_09_29.proof_file,
    'reconciliation-adventist-bakersfield-qies-dual-ccn-crosscheck-2026-09-29.json');
  assert.equal(manual.latest_qies_dual_ccn_crosscheck_2026_09_29.records.length, 2);
  assert.equal(manual.latest_qies_dual_ccn_crosscheck_2026_09_29.disposition_changed, false);
});
