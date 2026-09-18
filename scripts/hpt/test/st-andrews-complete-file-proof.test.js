'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('St. Andrews complete file resolves date without assigning sibling campuses', () => {
  const proof = require(path.join(audit, 'reconciliation-st-andrews-complete-file-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === '351307');
  const row = loadReviewedView(audit).compliance.find(item => item.ccn === '351307');
  assert.equal(proof.pointer_location_name, 'SMP Health - St. Andrews');
  assert.equal(proof.sibling_pointer_locations_not_assigned_to_this_ccn.length, 2);
  assert.equal(proof.file_content_length, proof.full_file_bytes_retained_in_memory);
  assert.equal(proof.full_file_sha256, resolution.evidence.fileSha256);
  assert.equal(proof.pointer_sha256, resolution.evidence.pointerSha256);
  assert.equal(proof.declared_address, '316 Ohmer Street, Bottineau, ND 58318');
  assert.equal(proof.declared_license_state, 'ND');
  assert.equal(row.mrf_url, proof.pointer_file_url);
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.mrf_last_updated, '2025-11-12');
});
