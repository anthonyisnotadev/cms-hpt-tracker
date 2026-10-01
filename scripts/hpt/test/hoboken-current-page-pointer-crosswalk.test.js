'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('Hoboken page-file header is preserved without inferring pointer equivalence or resolution', () => {
  const audit = 'data/hpt-audit/';
  const proof = read(`${audit}reconciliation-hoboken-current-page-pointer-crosswalk-proof-2026-09-30.json`);
  const manual = read(`${audit}reconciliation-manual-access-observations.json`).records.find(row => row.ccn === '310040');
  const work = read(`${audit}unresolved-investigation-worklist.json`).records.find(row => row.ccn === '310040');
  const reconciliation = read(`${audit}nationwide-reconciliation.json`).records.find(row => row.ccn === '310040');
  const snapshot = read(`${audit}nationwide-verification.json`);

  assert.equal(proof.ccn, '310040');
  assert.equal(proof.pointer_location_name, 'Hoboken University Hospital');
  assert.equal(proof.declared_hospital_name, 'Hoboken University Hospital');
  assert.equal(proof.declared_address, '308 Willow Avenue, Hoboken, NJ 07030');
  assert.equal(proof.declared_license_state, 'NJ');
  assert.equal(proof.version, '3.0.0');
  assert.equal(proof.current_file_attempt.sample_bytes, 262144);
  assert.equal(proof.pointer_file_relation.current_page_file_sample_sha256,
    proof.pointer_file_relation.prior_bounded_pointer_file_sample_sha256);
  assert.equal(proof.pointer_file_relation.complete_file_equivalence_proven, false);
  assert.notEqual(proof.pointer_mrf_url, proof.pricing_page_file_url);
  assert.equal(manual.complete_file_equivalence_proven, false);
  assert.equal(manual.disposition, 'page-file-header-observed-pointer-file-equivalence-unproven');
  assert.equal(work.current_disposition, 'pointer-facility-match-unresolved');
  assert.match(work.next_action, /complete file|complete-file/i);
  assert.equal(reconciliation.workstream, 'genuinely-unresolved-investigation');
  assert.equal(reconciliation.next_action, work.next_action);
  assert.equal(snapshot.summary.hospitals, 5419);
  assert.equal(snapshot.summary.effective_counts['genuinely-unresolved'], 582);
  assert.equal(snapshot.summary.unresolved, 585);
});
