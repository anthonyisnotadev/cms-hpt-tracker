'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../build-unresolved-investigation-worklist');

const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('Parkview Medical Center keeps the corrected campus file separate from the Pueblo West sibling', () => {
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
  const latest = read('data/hpt-audit/reconciliation-manual-access-observations.json').records.find(item => item.ccn === proof.ccn).latest_live_page_recheck;
  assert.equal(latest.page_link_targets_same, true);
  assert.equal(latest.shared_file_range_status, 206);
  assert.match(latest.shared_file_header, /Pueblo West/);
  assert.equal(latest.pointer_medical_center_target_status, 404);
  const reconciliation = read('data/hpt-audit/nationwide-reconciliation.json');
  const verification = read('data/hpt-audit/nationwide-verification.json');
  const row = reconciliation.records.find(item => item.ccn === proof.ccn);
  const queue = read('data/hpt-audit/unresolved-investigation-worklist.json').records.find(item => item.ccn === proof.ccn);
  assert.equal(row.workstream, 'consistent');
  assert.equal(queue, undefined);
  assert.equal(row.manual_access_observation.disposition, 'official-pointer-and-page-linked-mrf-identity-confirmed');
  assert.equal(row.manual_access_observation.pointer_url, 'https://www.uchealth.org/cms-hpt.txt');
  const rebuilt = build(reconciliation, verification).records.find(item => item.ccn === proof.ccn);
  assert.equal(rebuilt, undefined);
});
