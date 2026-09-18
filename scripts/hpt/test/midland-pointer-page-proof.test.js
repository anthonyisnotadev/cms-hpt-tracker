'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Midland district page CSV remains distinct from the failed pointer target and keeps its literal name', () => {
  const { records } = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-midland-pointer-page-proof.json'), 'utf8'));
  assert.equal(records.length, 1);
  const row = records[0];
  assert.equal(row.ccn, '450133');
  const bytes = fs.readFileSync(path.join(root, row.retained_sample));
  assert.equal(bytes.length, 262144);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.current_mrf_sha256);
  assert.equal(row.pointer_mrf_http_status, 404);
  assert.equal(row.current_mrf_http_status, 206);
  assert.notEqual(row.pointer_mrf_url, row.current_mrf_url);
  assert.equal(row.pointer_mrf_url.includes('Price Transparency'), true);
  assert.equal(row.pointer_mrf_request_url.includes('Price%20Transparency'), true);
  assert.equal(row.declared_hospital_name, 'Midland County Hospital District');
  assert.ok(row.declared_address.includes('400 Rosalind Redfern Grover Parkway, Midland, TX 79701'));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const resolution = ledger.find(item => item.ccn === row.ccn);
  assert.equal(resolution.evidence.observedFinding, 'pointer-links-unavailable-mrf-source-page-current-file');
  assert.equal(resolution.evidence.pointerMrfUrl, row.pointer_mrf_url);
  assert.equal(resolution.evidence.url, row.current_mrf_url);
  const standing = loadReviewedView(audit).compliance.find(item => item.ccn === row.ccn);
  assert.equal(standing.finding, resolution.evidence.observedFinding);
  assert.equal(standing.mrf_url, row.current_mrf_url);
});
