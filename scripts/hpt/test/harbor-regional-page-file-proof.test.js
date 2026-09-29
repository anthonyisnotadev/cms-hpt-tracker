'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Harbor Regional page file stays separate from its 404 pointer target', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-harbor-regional-page-file-proof.json'), 'utf8'));
  const resolution = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'))
    .find(row => row.ccn === '500031');
  const standing = loadReviewedView(audit).compliance.find(row => row.ccn === '500031');
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(proof.pointer_mrf_http_status, 404);
  assert.notEqual(proof.pointer_mrf_url, proof.current_mrf_url);
  assert.equal(sample.length, proof.retained_bytes);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.current_mrf_sha256);
  assert.equal(proof.declared_address, '915 Anderson Drive, Aberdeen, WA 98520');
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.url, proof.current_mrf_url);
  assert.equal(standing.finding, 'pointer-links-unavailable-mrf-source-page-current-file');
  assert.equal(standing.mrf_url, proof.current_mrf_url);
  assert.notEqual(standing.finding, 'compliant-observed');
});
