'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('First Colony page file does not inherit the broader system pointer', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-first-colony-page-file-proof.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const resolution = ledger.find(row => row.ccn === proof.ccn);
  const e = resolution.evidence;
  const standing = loadReviewedView(audit).compliance.find(row => row.ccn === proof.ccn);

  assert.equal(resolution.base.domain, 'memorialhermann.org');
  assert.equal(e.officialDomain, 'memorialhermannfirstcolony.com');
  assert.equal(e.url, proof.first_party_page_browser_file_url);
  assert.equal(e.fileSha256, proof.file_sample_sha256);
  assert.equal(e.bytesRetained, proof.file_sample_bytes);
  assert.equal(e.pointerHttpStatus, 403);
  assert.equal(e.pointerIssue, 'root-pointer-http-error');
  assert.equal(e.completeFileValidated, false);
  assert.equal(e.declared_hospital_name.toUpperCase(), proof.cms_ccn_name);
  assert.equal(e.declared_address, proof.file_declared_address);
  assert.equal(e.declared_license_state, 'TX');
  assert.equal(standing.finding, 'official-page-mrf-root-pointer-unavailable');
  assert.equal(standing.domain, 'memorialhermannfirstcolony.com');
  assert.equal(standing.mrf_url, e.url);
});
