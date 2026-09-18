'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../build-unresolved-investigation-worklist');

const root = path.resolve(__dirname, '../../..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

test('South Oaks campus root shares a pointer with no South Oaks entry, not a sibling file', () => {
  const proof = read('data/hpt-audit/reconciliation-south-oaks-root-pointer-proof.json');
  const pointer = fs.readFileSync(path.join(root, proof.retained_pointer_file));
  const text = pointer.toString();
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.site_root_pointer_sha256);
  assert.equal(pointer.length, proof.site_root_pointer_bytes);
  assert.equal((text.match(/^location-name:/gm) || []).length, proof.pointer_location_count);
  assert.doesNotMatch(text, /South Oaks|Amityville|Sunrise Highway/i);
  const verification = read('data/hpt-audit/nationwide-verification.json');
  const reconciliation = read('data/hpt-audit/nationwide-reconciliation.json');
  const queue = read('data/hpt-audit/unresolved-investigation-worklist.json').records.find(row => row.ccn === proof.ccn);
  assert.equal(reconciliation.records.find(row => row.ccn === proof.ccn).workstream, 'genuinely-unresolved-investigation');
  assert.equal(queue.current_disposition, proof.disposition);
  assert.equal(queue.nationwide_disposition, 'pointer-facility-match-unresolved');
  assert.equal(queue.evidence_gate, 'facility-specific-pointer-entry-or-page-file');
  assert.equal(queue.candidate_file_recorded, false);
  const tampered = structuredClone(reconciliation);
  tampered.records.find(row => row.ccn === proof.ccn).manual_access_observation.pointer_sha256 = '0'.repeat(64);
  const untrusted = build(tampered, verification).records.find(row => row.ccn === proof.ccn);
  assert.equal(untrusted.current_disposition, 'pointer-facility-match-unresolved');
  assert.equal(untrusted.evidence_gate, 'pointer-facility-match');
});
