'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Bournewood page CSV remains distinct from the 404 pointer target and lacks declared license state', () => {
  const { records } = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-bournewood-pointer-page-proof.json'), 'utf8'));
  assert.equal(records.length, 1);
  const row = records[0];
  assert.equal(row.ccn, '224022');
  const bytes = fs.readFileSync(path.join(root, row.retained_sample));
  assert.equal(bytes.length, 20266);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.current_mrf_sha256);
  assert.equal(row.pointer_mrf_http_status, 404);
  assert.equal(row.current_mrf_http_status, 200);
  assert.notEqual(row.pointer_mrf_url, row.current_mrf_url);
  assert.equal(row.declared_license_state, null);
  assert.equal(row.declared_address, '300 SOUTH STREET  BROOKLINE  MA 02467');
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const resolution = ledger.find(item => item.ccn === row.ccn);
  assert.equal(resolution.evidence.observedFinding, 'pointer-links-unavailable-mrf-source-page-current-file');
  assert.equal(resolution.evidence.pointerMrfUrl, row.pointer_mrf_url);
  assert.equal(resolution.evidence.url, row.current_mrf_url);
  assert.equal(resolution.evidence.declared_license_state, '');
  const standing = loadReviewedView(audit).compliance.find(item => item.ccn === row.ccn);
  assert.equal(standing.finding, resolution.evidence.observedFinding);
  assert.equal(standing.mrf_url, row.current_mrf_url);
});
