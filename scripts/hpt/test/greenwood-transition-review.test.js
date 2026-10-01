'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-greenwood-transition-review.json'));

test('Greenwood transition preserves former publisher files and separates current pointer evidence', () => {
  assert.equal(proof.ccn, '250099');
  assert.equal(proof.current_publisher_domain, 'umc.edu');
  assert.equal(proof.current_pointer_lists_greenwood, false);
  assert.equal(proof.current_pointer_file_chain_verified, false);
  const pointerRecheck = require(path.join(audit,
    'reconciliation-greenwood-ummc-current-root-pointer-crosscheck-2026-09-29.json'));
  assert.equal(pointerRecheck.ccn, '250099');
  assert.equal(pointerRecheck.official_root_pointer.status, 200);
  assert.equal(pointerRecheck.official_root_pointer.greenwood_entry_present, false);
  assert.equal(pointerRecheck.official_root_pointer.sha256,
    '4e90bcdcd7db39a11b03a5b05c699373d9b3c54fa49af5ffeb841b0cd5aa5b6f');
  assert.deepEqual(pointerRecheck.official_root_pointer.parsed_locations,
    ['UMMC Jackson Hospital', 'UMMC Grenada Hospital', 'UMMC Holmes County Hospital', 'UMMC Madison Hospital']);
  assert.equal(proof.legacy_pointer_status, 404);
  assert.equal(proof.vendor_files.length, 2);
  for (const file of proof.vendor_files) {
    const sample = fs.readFileSync(path.join(root, file.retained_sample));
    assert.equal(sample.length, 262144);
    assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), file.sample_sha256);
    assert.equal(file.declared_address, '1401 River Rd, , Greenwood, MS 38930');
    assert.equal(file.declared_license_state, 'MS');
    assert.equal(file.declared_date, '2026-08-05');
    assert.equal(file.version, '3.0.0');
  }
  const row = require(path.join(audit, 'unresolved-investigation-worklist.json')).records
    .find(item => item.ccn === '250099');
  assert.equal(row.reviewed_follow_up, true);
  assert.equal(row.next_action, pointerRecheck.next_action);
  assert.equal(row.current_disposition, 'pointer-facility-match-unresolved');
});
