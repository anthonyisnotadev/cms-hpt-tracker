'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../build-unresolved-investigation-worklist');

const root = path.resolve(__dirname, '../../..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

test('Antelope pointer/site/CCN identity review moves the queue gate, not the file verdict', () => {
  const proof = read('data/hpt-audit/reconciliation-antelope-pointer-access-proof.json');
  const pointer = fs.readFileSync(path.join(root, proof.retained_pointer_file));
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.retained_pointer_sha256);
  assert.match(pointer.toString(), /location-name: ANTELOPE MEMORIAL HOSPITAL/);
  assert.ok(pointer.toString().includes(proof.retained_pointer_mrf_url));
  assert.notEqual(proof.retained_pointer_mrf_url, proof.prior_crawl_mrf_url);
  assert.equal(proof.current_pointer_target_head_status, 403);
  assert.equal(proof.current_pointer_target_bounded_get_status, 403);
  const reconciliation = read('data/hpt-audit/nationwide-reconciliation.json');
  const verification = read('data/hpt-audit/nationwide-verification.json');
  const row = reconciliation.records.find(item => item.ccn === '281326');
  const queue = read('data/hpt-audit/unresolved-investigation-worklist.json').records.find(item => item.ccn === '281326');
  assert.equal(row.standing_finding, 'not-assessed-nationwide-pointer-facility-match-unresolved');
  assert.equal(row.workstream, 'genuinely-unresolved-investigation');
  assert.equal(queue.current_disposition, proof.disposition);
  assert.equal(queue.nationwide_disposition, 'pointer-facility-match-unresolved');
  assert.equal(queue.evidence_gate, 'file-access');
  assert.match(queue.next_action, /Do not treat S3 403 as file absence/);
  const tampered = structuredClone(reconciliation);
  tampered.records.find(item => item.ccn === '281326').manual_access_observation.pointer_sha256 = '0'.repeat(64);
  const untrusted = build(tampered, verification).records.find(item => item.ccn === '281326');
  assert.equal(untrusted.current_disposition, 'pointer-facility-match-unresolved');
  assert.equal(untrusted.evidence_gate, 'pointer-facility-match');
});
