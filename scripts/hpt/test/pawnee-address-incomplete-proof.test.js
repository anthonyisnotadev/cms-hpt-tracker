'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Pawnee keeps the literal missing street component separate from verified file metadata', () => {
  const proof = require(path.join(audit, 'reconciliation-pawnee-address-incomplete-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === '281302');
  const row = loadReviewedView(audit).compliance.find(item => item.ccn === '281302');
  assert.equal(proof.first_party_price_link, proof.pointer_source_page_url);
  assert.equal(proof.file_content_length, proof.full_file_bytes_retained_in_memory);
  assert.equal(proof.full_file_sha256, resolution.evidence.fileSha256);
  assert.equal(proof.pointer_sha256, resolution.evidence.pointerSha256);
  assert.equal(proof.first_party_address, '600 I Street, Pawnee City, NE 68420');
  assert.equal(proof.declared_address, '600 Street, Pawnee City, NE 68420');
  assert.equal(proof.declared_license_state, 'NE');
  assert.equal(row.domain, 'pawneehospital.socs.net');
  assert.equal(row.mrf_url, proof.pointer_file_url);
  assert.equal(row.finding, 'mrf-address-field-incomplete');
  assert.equal(row.mrf_last_updated, '2026-03-12');
});
