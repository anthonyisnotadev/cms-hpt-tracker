'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const proof = require(path.join(root, 'data/hpt-audit/reconciliation-crestwood-dns-override-proof.json')).record;
const auditDir = path.join(root, 'data/hpt-audit');

test('Crestwood exact-host DNS workaround yields a pointer-linked, identity-matched bounded file', () => {
  assert.equal(proof.ccn, '010131');
  assert.equal(proof.pointer_http_status, 206);
  assert.equal(proof.mrf_http_status, 206);
  assert.equal(proof.declared_hospital_name, 'Crestwood Medical Center');
  assert.equal(proof.declared_address, 'One Hospital Drive, Huntsville, AL 35801');
  assert.equal(proof.declared_state, 'AL');
  assert.equal(proof.declared_date, '2026-01-01');
  assert.equal(proof.version, '3.0.0');
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sample.length, proof.retained_bytes);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.mrf_sample_sha256);
  const standing = loadReviewedView(auditDir).compliance.find(row => row.ccn === proof.ccn);
  assert.equal(standing.finding, 'compliant-observed');
  assert.equal(standing.pointer_url, proof.pointer_url);
  assert.equal(standing.mrf_url, proof.mrf_url);
});
