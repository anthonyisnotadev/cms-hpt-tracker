'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Surgical Hospital of Oklahoma complete pointer file keeps the blank KS header conflict explicit', () => {
  const root = path.resolve(__dirname, '../../..');
  const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-surgical-oklahoma-pointer-file-proof.json'), 'utf8'));
  assert.equal(proof.ccn, '370201');
  assert.equal(proof.pointer_mrf_complete_retrieved, true);
  assert.equal(proof.pointer_mrf_complete_bytes, 4916732);
  assert.equal(proof.pointer_mrf_complete_sha256, 'f1dd77b792860e64a3a4887002ac435daf8ac2f77b1dcd1afed9f576de8c59e9');
  assert.equal(proof.pointer_mrf_nonempty_data_rows, 34141);
  assert.equal(proof.pointer_mrf_license_value, '');
  assert.match(proof.interpretation, /not a legal conclusion/);
  assert.equal(proof.pricing_page_mrf_link_http_status, 404);
});
