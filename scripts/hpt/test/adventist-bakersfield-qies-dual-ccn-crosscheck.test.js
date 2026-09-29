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

  const unresolved = verification.records.find(row => row.ccn === '050455');
  const queued = worklist.records.find(row => row.ccn === '050455');
  assert.equal(unresolved.pointer_state, 'retrieved-facility-match-unresolved');
  assert.match(queued.next_action, /corrected first-party pointer\/file or authoritative public mapping/);
});
