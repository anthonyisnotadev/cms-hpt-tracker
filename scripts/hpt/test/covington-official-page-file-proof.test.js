'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Covington uses the official site, preserving root 404 and literal file location name', () => {
  const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-covington-official-page-file-proof.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const standing = loadReviewedView(audit).compliance.find(item => item.ccn === row.ccn);
  const bytes = fs.readFileSync(path.join(root, row.retained_sample));
  assert.equal(row.pointer_http_status, 404);
  assert.equal(bytes.length, row.retained_bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.current_mrf_sha256);
  const resolution = ledger.find(item => item.ccn === row.ccn);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.location_name, 'covington_county_hospital_.1');
  assert.equal(resolution.evidence.cmsValidator.version, '1.10.8');
  assert.equal(resolution.evidence.cmsValidator.errors, 0);
  assert.equal(resolution.evidence.cmsValidator.alerts, 0);
  assert.equal(standing.finding, 'compliant-observed');
  assert.equal(standing.domain, 'covingtoncountyhospital.com');
  assert.equal(standing.mrf_url, row.current_mrf_url);
  assert.match(standing.evidence, /completely retrieved and structurally validated MRF/);
});
