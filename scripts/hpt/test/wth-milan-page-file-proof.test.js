'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('WTH Milan keeps its malformed declared address while preserving the page-linked file', () => {
  const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-wth-milan-page-file-proof.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const standing = loadReviewedView(audit).compliance.find(item => item.ccn === row.ccn);
  const bytes = fs.readFileSync(path.join(root, row.retained_sample));
  assert.equal(row.pointer_http_status, 404);
  assert.equal(bytes.length, row.retained_bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.current_mrf_sha256);
  const resolution = ledger.find(item => item.ccn === row.ccn);
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.declaredAddressDisposition,
    'declared-address-malformed-street-city-state-match');
  assert.equal(resolution.evidence.declared_address, row.declared_address);
  assert.equal(standing.finding, 'official-page-mrf-root-pointer-unavailable');
  assert.equal(standing.mrf_url, row.current_mrf_url);
});
