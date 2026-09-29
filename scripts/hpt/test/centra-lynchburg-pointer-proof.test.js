'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../build-unresolved-investigation-worklist');

const root = path.resolve(__dirname, '../../..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

test('Centra Lynchburg newer pointer lead keeps the content gate and preserves prior pointer proof', () => {
  const proof = read('data/hpt-audit/reconciliation-centra-lynchburg-pointer-proof.json');
  const pointer = fs.readFileSync(path.join(root, proof.retained_pointer_file));
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.retained_pointer_sha256);
  assert.match(pointer.toString(), /location-name: Lynchburg General Hospital\r?\n/);
  assert.ok(pointer.toString().includes(`mrf-url: ${proof.pointer_file_url}`));
  const roster = read('cms_data/hpt/roster.json').find(row => row.ccn === proof.ccn);
  assert.equal(roster.name, proof.roster_name);
  assert.equal(`${roster.address}, ${roster.city}, ${roster.state} ${roster.zip}`, proof.roster_address);
  const reconciliation = read('data/hpt-audit/nationwide-reconciliation.json');
  const verification = read('data/hpt-audit/nationwide-verification.json');
  const row = reconciliation.records.find(item => item.ccn === proof.ccn);
  const queue = read('data/hpt-audit/unresolved-investigation-worklist.json').records.find(item => item.ccn === proof.ccn);
  assert.equal(row.manual_access_observation.proof_file, 'reconciliation-centra-lynchburg-current-pricing-route-recheck-2026-09-27.json');
  assert.equal(row.manual_access_observation.disposition, 'current-first-party-pricing-page-exposes-newer-pointer-and-labeled-file-transport-unresolved');
  assert.match(row.manual_access_observation.current_page_linked_pointer_url, /2025-12\/cms-hpt\.txt$/);
  assert.equal(row.manual_access_observation.pointer_web_reader_status, 403);
  assert.equal(row.workstream, 'genuinely-unresolved-investigation');
  assert.equal(queue.current_disposition, 'pointer-facility-match-unresolved');
  assert.equal(queue.evidence_gate, 'pointer-facility-match');
  assert.equal(queue.candidate_file_recorded, false);
  assert.match(queue.next_action, /2025-12 pointer/);
  const tampered = structuredClone(reconciliation);
  tampered.records.find(item => item.ccn === proof.ccn).manual_access_observation.pointer_sha256 = '0'.repeat(64);
  const untrusted = build(tampered, verification).records.find(item => item.ccn === proof.ccn);
  assert.equal(untrusted.current_disposition, 'pointer-facility-match-unresolved');
  assert.equal(untrusted.evidence_gate, 'pointer-facility-match');
});
