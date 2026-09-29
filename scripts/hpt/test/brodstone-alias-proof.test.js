'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Brodstone former-name pointer resolves the exact campus but retains observed stale date', () => {
  const proof = require(path.join(audit, 'reconciliation-brodstone-alias-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === '281315');
  const row = loadReviewedView(audit).compliance.find(item => item.ccn === '281315');
  assert.equal(proof.pointer_location_name, 'Brodstone Memorial Hospital');
  assert.match(proof.rename_source_statement, /rebranded to Brodstone Healthcare/);
  assert.equal(proof.file_content_length, proof.full_file_bytes_retained_in_memory);
  assert.equal(proof.full_file_sha256, resolution.evidence.fileSha256);
  assert.equal(proof.pointer_sha256, resolution.evidence.pointerSha256);
  assert.equal(proof.declared_address, '520 East Tenth Street, Superior, NE 68978');
  assert.equal(proof.declared_license_state, 'NE');
  assert.equal(row.domain, 'brodstonehealthcare.org');
  assert.equal(row.mrf_url, proof.pointer_file_url);
  assert.equal(row.finding, 'mrf-stale-over-365-days');
  assert.equal(row.mrf_last_updated, '2025-06-05');
});
