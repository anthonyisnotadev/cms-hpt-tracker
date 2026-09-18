'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Atoka retry resolves transport failure and verifies exact pointer-linked campus metadata', () => {
  const proof = require(path.join(audit, 'reconciliation-atoka-complete-file-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === '371300');
  const row = loadReviewedView(audit).compliance.find(item => item.ccn === '371300');
  assert.match(proof.first_direct_file_attempt, /DNS resolving timed out/);
  assert.equal(proof.first_party_price_link, proof.pointer_source_page_url);
  assert.equal(proof.file_content_length, proof.full_file_bytes_retained_in_memory);
  assert.equal(proof.full_file_sha256, resolution.evidence.fileSha256);
  assert.equal(proof.pointer_sha256, resolution.evidence.pointerSha256);
  assert.match(proof.declared_address, /1590 West Liberty Road, Atoka, OK\s+74525/);
  assert.equal(proof.declared_license_state, 'OK');
  assert.equal(row.domain, 'atokamedicalcenter.org');
  assert.equal(row.mrf_url, proof.pointer_file_url);
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.mrf_last_updated, '2026-07-28');
});
