'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Presentation Medical Center maps only to the distinct St. Kateri pointer file', () => {
  const proof = require(path.join(audit, 'reconciliation-st-kateri-presentation-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === '351316');
  const row = loadReviewedView(audit).compliance.find(item => item.ccn === '351316');
  assert.match(proof.former_name_source_statement, /formerly Presentation Medical Center/);
  assert.equal(proof.pointer_location_name, 'SMP Health - St. Kateri');
  assert.equal(proof.sibling_pointer_locations_not_assigned_to_this_ccn.length, 2);
  assert.equal(proof.file_content_length, proof.full_file_bytes_retained_in_memory);
  assert.equal(proof.full_file_sha256, resolution.evidence.fileSha256);
  assert.equal(proof.pointer_sha256, resolution.evidence.pointerSha256);
  assert.equal(proof.declared_address, '213 Second Avenue Northeast, Rolla, ND 58367');
  assert.equal(proof.declared_license_state, 'ND');
  assert.equal(row.mrf_url, proof.pointer_file_url);
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.mrf_last_updated, '2025-11-25');
});
