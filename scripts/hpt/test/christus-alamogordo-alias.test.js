'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-christus-alamogordo-alias-proof.json'));

test('CHRISTUS Alamogordo current name and Gerald Champion pointer stay source-bound', () => {
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sample.length, proof.file_sample_bytes);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.file_sample_sha256);
  assert.ok(proof.file_total_bytes > sample.length);
  assert.equal(proof.identity_page_current_name, 'CHRISTUS Southern New Mexico');
  assert.equal(proof.identity_page_former_name, 'Gerald Champion');
  assert.equal(proof.pointer_location_name, 'Gerald Champion Regional Medical Center');
  assert.equal(proof.declared_address, '2669 N Scenic Dr, Alamogordo, NM 88310');
  assert.equal(proof.declared_license_state, 'NM');
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === proof.ccn);
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.domain, 'christushealth.org');
  assert.equal(row.pointer_url, proof.pointer_url);
  assert.equal(row.mrf_url, proof.pointer_mrf_url);
  assert.equal(view.history[proof.ccn].finding, 'not-assessed-domain-unknown');
});
