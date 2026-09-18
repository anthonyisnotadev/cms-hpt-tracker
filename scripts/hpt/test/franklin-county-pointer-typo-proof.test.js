'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Franklin County pointer typo does not obscure exact campus and file identity', () => {
  const proof = require(path.join(audit, 'reconciliation-franklin-county-pointer-typo-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === '281311');
  const row = loadReviewedView(audit).compliance.find(item => item.ccn === '281311');
  assert.equal(proof.pointer_location_name_literal, 'Franklin Country Memorial Hospital');
  assert.equal(proof.first_party_finance_price_link, proof.pointer_source_page_url);
  assert.equal(proof.file_content_length, proof.full_file_bytes_retained_in_memory);
  assert.equal(proof.full_file_sha256, resolution.evidence.fileSha256);
  assert.equal(proof.pointer_sha256, resolution.evidence.pointerSha256);
  assert.equal(proof.declared_address, '1406 Q Street, Franklin, NE 68939');
  assert.equal(proof.declared_license_state, 'NE');
  assert.equal(row.domain, 'fcmh.com');
  assert.equal(row.mrf_url, proof.pointer_file_url);
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.mrf_last_updated, '2026-03-10');
});
