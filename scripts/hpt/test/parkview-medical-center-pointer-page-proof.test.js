'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../build-unresolved-investigation-worklist');

const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('Parkview Medical Center queue requires a corrected campus file, not the Pueblo West sibling', () => {
  const proof = read('data/hpt-audit/reconciliation-parkview-medical-center-pointer-page-proof.json');
  const pointer = fs.readFileSync(path.join(root, proof.retained_pointer_file));
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.retained_pointer_sha256);
  assert.ok(pointer.toString().includes(proof.pointer_medical_center_mrf_url));
  assert.ok(pointer.toString().includes(proof.pointer_pueblo_west_mrf_url));
  assert.notEqual(proof.pointer_medical_center_mrf_url, proof.pointer_pueblo_west_mrf_url);
  assert.equal(proof.pricing_page_medical_center_label_url, proof.pricing_page_pueblo_west_label_url);
  assert.equal(proof.pointer_medical_center_mrf_bounded_get_status, 404);
  assert.equal(proof.pueblo_west_file_bounded_get_status, 206);
  assert.match(proof.pueblo_west_file_declared_address, /Pueblo West/);
  const reconciliation = read('data/hpt-audit/nationwide-reconciliation.json');
  const verification = read('data/hpt-audit/nationwide-verification.json');
  const row = reconciliation.records.find(item => item.ccn === proof.ccn);
  const queue = read('data/hpt-audit/unresolved-investigation-worklist.json').records.find(item => item.ccn === proof.ccn);
  assert.equal(row.workstream, 'genuinely-unresolved-investigation');
  assert.equal(queue.current_disposition, 'mrf-facility-identity-unresolved');
  assert.equal(queue.standing_finding, 'not-assessed-nationwide-mrf-facility-identity-unresolved');
  assert.equal(queue.evidence_gate, 'file-identity');
  assert.match(queue.next_action, /publisher-corrected Medical Center pointer target/);
  assert.equal(row.manual_access_observation.fresh_pointer_sha256, verification.records.find(item => item.ccn === proof.ccn).pointer_corpus_sha256);
  const tampered = structuredClone(reconciliation);
  tampered.records.find(item => item.ccn === proof.ccn).manual_access_observation.retained_pointer_sha256 = '0'.repeat(64);
  const untrusted = build(tampered, verification).records.find(item => item.ccn === proof.ccn);
  assert.equal(untrusted.current_disposition, 'mrf-facility-identity-unresolved');
  assert.equal(untrusted.evidence_gate, 'file-identity');
});
