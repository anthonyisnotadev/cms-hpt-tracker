'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../../..');
test('Summit Oklahoma page-linked MRF is exact and root-pointer uncertainty remains explicit', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-summit-oklahoma-page-file-proof.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reviewed-resolutions.json'), 'utf8'));
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(proof.ccn, '370225');
  assert.equal(proof.declared_address, '1800 South Renaissance Boulevard, Edmond, OK 73013');
  assert.equal(proof.cms_template_version, '3.0.0');
  assert.equal(proof.mrf_bytes, 18567964);
  assert.equal(sample.length, 262144);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), '22d08afe0d997b9205a475902afc64cc51e8d80d1e1f436aa5ea8e9b7230f989');
  const resolution = ledger.find(row => row.ccn === '370225');
  assert.equal(resolution.evidence.observedFinding, 'official-page-mrf-root-pointer-unavailable');
  assert.equal(resolution.evidence.pointerHttpStatus, 404);
  assert.equal(resolution.evidence.fileBytes, 18567964);
});
