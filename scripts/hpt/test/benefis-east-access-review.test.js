'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-benefis-east-access-review.json'));

test('Benefis East has exact campus and shared-pointer lead but no file bytes', () => {
  const retained = fs.readFileSync(path.join(root, proof.retained_pointer_artifact));
  assert.equal(crypto.createHash('sha256').update(retained).digest('hex'), proof.retained_pointer_sha256);
  assert.equal(proof.pointer_east_location_name, 'Benefis Hospitals Inc - East Campus');
  assert.equal(proof.pointer_west_location_name, 'Benefis Hospitals Inc - West Campus');
  assert.equal(proof.direct_requests.length, 4);
  for (const request of proof.direct_requests) {
    assert.equal(request.http_status, 403);
    assert.equal(request.response_kind, 'html-access-denied');
    assert.match(request.response_sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(proof.browser_file_result, 'Access Denied');
  assert.equal(proof.file_bytes_verified, false);
  const row = require(path.join(audit, 'unresolved-investigation-worklist.json')).records
    .find(item => item.ccn === '270012');
  assert.equal(row.reviewed_follow_up, true);
  assert.equal(row.next_action, proof.next_action);
});
