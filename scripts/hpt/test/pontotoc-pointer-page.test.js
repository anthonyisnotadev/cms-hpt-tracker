'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-pontotoc-pointer-page-proof.json'));

test('Pontotoc retains the broken pointer target separately from the working page file', () => {
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sample.length, 262144);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.page_mrf_sha256);
  assert.equal(proof.pointer_mrf_http_status, 404);
  assert.notEqual(proof.pointer_mrf_url, proof.page_mrf_url);
  assert.equal(proof.declared_address, '176 South Main Street, Pontotoc, MS 38863');
  assert.equal(proof.declared_license_state, 'MS');
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '251308');
  assert.equal(row.domain, 'nmhs.net');
  assert.equal(row.pointer_url, proof.pointer_url);
  assert.equal(row.mrf_url, proof.page_mrf_url);
  assert.equal(row.finding, 'pointer-links-unavailable-mrf-source-page-current-file');
  assert.equal(view.history['251308'].finding, 'not-assessed-domain-unknown');
});
