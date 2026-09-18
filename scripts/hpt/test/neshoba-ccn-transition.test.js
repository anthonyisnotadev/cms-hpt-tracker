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
    assert.equal(observation.proof_file, 'reconciliation-neshoba-ccn-transition-proof.json');
    assert.equal(observation.complete_file_sha256, proof.current_file.complete_sha256);
    const work = (ccn === '250043' ? unresolved : standing).find(row => row.ccn === ccn);
    assert.equal(work.reviewed_follow_up, true);
    assert.match(work.next_action, /CMS enrollment\/status record/);
    assert.match(work.next_action, /fresh root pointer/);
  }
});
