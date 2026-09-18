'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Macon Samaritan CCN uses current name and exact campus to assign its pointer file', () => {
  const proof = require(path.join(audit, 'reconciliation-samaritan-macon-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === '261313');
  const row = loadReviewedView(audit).compliance.find(item => item.ccn === '261313');
  assert.match(proof.ccn_name_bridge, /261313/);
  assert.equal(proof.first_party_address, '1205 N. Missouri Street, Macon, MO 63552');
  assert.equal(proof.home_page_price_transparency_link, proof.pointer_source_page_url);
  assert.equal(proof.file_content_length, proof.full_file_bytes_retained_in_memory);
  assert.equal(proof.full_file_sha256, resolution.evidence.fileSha256);
  assert.equal(proof.pointer_sha256, resolution.evidence.pointerSha256);
  assert.equal(proof.declared_address, '1205 North Missouri Street, Macon, MO 63552');
  assert.equal(proof.declared_license_state, 'MO');
  assert.equal(row.domain, 'smhmo.org');
  assert.equal(row.mrf_url, proof.pointer_file_url);
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.mrf_last_updated, '2026-06-22');
});
