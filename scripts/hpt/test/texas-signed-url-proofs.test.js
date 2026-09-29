'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const ledger = require(path.join(audit, 'reviewed-resolutions.json'));
const view = loadReviewedView(audit);

for (const [ccn, address] of [
  ['450674', '7600 FANNIN STREET, HOUSTON, TX, 77054'],
  ['450804', '7401 SOUTH MAIN STREET, HOUSTON, TX, 77030'],
]) {
  test(`${ccn} preserves stale pointer signature separately from readable page file`, () => {
    const proof = require(path.join(audit, `reconciliation-texas-signed-url-${ccn}-proof.json`));
    const resolution = ledger.find(row => row.ccn === ccn);
    assert.equal(proof.pointer_mrf_http_status, 403);
    assert.equal(proof.pointer_mrf_error_code, 'AuthenticationFailed');
    assert.equal(proof.page_mrf_http_status, 206);
    assert.equal(proof.pointer_source_page_redirects_to_current_page, true);
    assert.notEqual(proof.pointer_mrf_url, proof.page_mrf_url);
    assert.equal(new URL(proof.pointer_mrf_url).pathname, new URL(proof.page_mrf_url).pathname);
    assert.deepEqual(proof.signed_query_fields_changed, ['si', 'sv', 'sig']);
    assert.equal(proof.declared_address, address);
    assert.equal(proof.declared_license_state, 'TX');
    assert.equal(proof.declared_version, '3.0.0');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.page_mrf_sample_sha256);
    assert.equal(resolution.action, 'replace-observation');
    assert.equal(resolution.evidence.observedFinding, 'pointer-links-unavailable-mrf-source-page-current-file');
    assert.equal(resolution.evidence.pointerMrfUrl, proof.pointer_mrf_url);
    assert.equal(resolution.evidence.url, proof.page_mrf_url);
    const row = view.compliance.find(item => item.ccn === ccn);
    assert.equal(row.finding, 'pointer-links-unavailable-mrf-source-page-current-file');
    assert.equal(view.history[ccn].finding, 'mrf-blocked-to-automation');
  });
}
