'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Georgia Jefferson Hospital excludes Pennsylvania file but retains Georgia pointer evidence', () => {
  const { compliance, history } = loadReviewedView(audit);
  const row = compliance.find(item => item.ccn === '110100');
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(item => item.ccn === '110100');
  assert.equal(row.finding, 'not-assessed-identity-conflict');
  assert.equal(row.domain, 'jeffersonhosp.com');
  assert.equal(row.mrf_url, '');
  assert.equal(row.mrf_last_updated, '');
  assert.match(history['110100'].mrf_url, /ahn\.org/);
  assert.equal(resolution.proof.rejected_header_license_state, 'PA');
  assert.equal(resolution.proof.current_header_address, '1067 Peachtree Street, Louisville, Georgia 30434');
  assert.equal(resolution.proof.current_header_license_state_field, 'license_number|CA');
  assert.equal(resolution.proof.current_header_version, '2.0.0');
  assert.match(resolution.proof.pointer_mrf_url, /jeffersonhosp\.com\/wp-content\/uploads\/2025\/01\//);
  assert.match(resolution.proof.current_mrf_sample_sha256, /^[a-f0-9]{64}$/);
  assert.notEqual(resolution.proof.rejected_mrf_url, resolution.proof.pointer_mrf_url);
});
