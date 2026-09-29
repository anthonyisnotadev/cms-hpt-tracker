'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Union County wrapper redirects to an identity-matched file with its own stale date', () => {
  const proof = require(path.join(audit, 'reconciliation-union-county-wrapper-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === '321304');
  const row = loadReviewedView(audit).compliance.find(item => item.ccn === '321304');
  assert.equal(proof.pointer_file_wrapper_host, 'linkprotect.cudasvc.com');
  assert.equal(proof.pointer_file_redirect_status, 302);
  assert.equal(proof.pointer_file_redirect_target, row.mrf_url);
  assert.equal(proof.first_party_price_link, proof.pointer_source_page_decoded_target);
  assert.equal(proof.file_content_length, proof.full_file_bytes_retained_in_memory);
  assert.equal(proof.full_file_sha256, resolution.evidence.fileSha256);
  assert.equal(proof.pointer_sha256, resolution.evidence.pointerSha256);
  assert.match(proof.declared_address, /300 Wilson Street,\s+Clayton, NM 88415/);
  assert.equal(proof.declared_license_state, 'NM');
  assert.equal(row.domain, 'ucgh.net');
  assert.equal(row.finding, 'mrf-stale-over-365-days');
  assert.equal(row.mrf_last_updated, '2025-07-01');
  assert.notEqual(row.mrf_last_updated, proof.current_price_page_displayed_last_modified);
});
