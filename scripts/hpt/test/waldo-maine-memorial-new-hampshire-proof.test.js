'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Waldo Maine replaces New Hampshire Memorial file and preserves stale date', () => {
  const { compliance, history } = loadReviewedView(audit);
  const row = compliance.find(item => item.ccn === '201312');
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(item => item.ccn === '201312');
  assert.equal(row.finding, 'mrf-stale-over-365-days');
  assert.equal(row.domain, 'mainehealth.org');
  assert.match(row.mrf_url, /machine-readable-files\/7977\//);
  assert.equal(row.mrf_last_updated, '2025-09-09');
  assert.match(history['201312'].mrf_url, /machine-readable-files\/7979\//);
  assert.equal(resolution.proof.rejected_header_license_state, 'NH');
  assert.equal(resolution.evidence.declared_license_state, 'ME');
});
