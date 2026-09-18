'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-george-regional-access-review.json'));

test('George Regional keeps challenged file links separate and a specific unresolved next step', () => {
  const retained = fs.readFileSync(path.join(root, proof.retained_pointer_artifact));
  assert.equal(crypto.createHash('sha256').update(retained).digest('hex'), proof.retained_pointer_sha256);
  assert.notEqual(proof.retained_pointer_mrf_url, proof.price_page_web_reader_download_url);
  for (const result of [proof.current_pointer_client, proof.pointer_file_client, proof.page_file_client]) {
    assert.equal(result.status, 202);
    assert.equal(result.response_kind, 'html-security-challenge');
    assert.match(result.response_sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(proof.byte_readable_file_verified, false);
  const queue = require(path.join(audit, 'unresolved-investigation-worklist.json')).records
    .find(row => row.ccn === '250036');
  assert.equal(queue.reviewed_follow_up, true);
  assert.equal(queue.investigation_tier, 2);
  assert.equal(queue.next_action, proof.next_action);
  assert.match(queue.next_action, /both distinct CSV URLs/);
});
