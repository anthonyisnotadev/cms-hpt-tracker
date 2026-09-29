'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Burgess broken pointer target remains distinct from current page-linked CSV', () => {
  const { record: row } = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-burgess-pointer-mismatch-proof.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const standing = loadReviewedView(audit).compliance.find(item => item.ccn === row.ccn);
  const bytes = fs.readFileSync(path.join(root, row.retained_sample));
  assert.equal(row.ccn, '161359');
  assert.equal(bytes.length, row.retained_bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.current_mrf_sha256);
  assert.equal(row.pointer_mrf_http_status, 404);
  assert.notEqual(row.pointer_mrf_url, row.current_mrf_url);
  const resolution = ledger.find(item => item.ccn === row.ccn);
  assert.equal(resolution.evidence.observedFinding, 'pointer-links-unavailable-mrf-source-page-current-file');
  assert.equal(resolution.evidence.pointerMrfUrl, row.pointer_mrf_url);
  assert.equal(resolution.evidence.url, row.current_mrf_url);
  assert.equal(standing.finding, resolution.evidence.observedFinding);
  assert.equal(standing.mrf_url, row.current_mrf_url);
});
