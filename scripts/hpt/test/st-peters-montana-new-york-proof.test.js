'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Helena St Peters replaces Albany archive but preserves E Broadway conflict', () => {
  const { compliance, history } = loadReviewedView(audit);
  const row = compliance.find(item => item.ccn === '270003');
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(item => item.ccn === '270003');
  assert.equal(row.finding, 'mrf-address-field-conflicts-facility');
  assert.equal(row.domain, 'sphealth.org');
  assert.match(row.mrf_url, /st-peters-health-regional-medical-center_standardcharges\.csv/);
  assert.equal(row.mrf_last_updated, '2026-03-16');
  assert.match(history['270003'].mrf_url, /trinity-health\.org/);
  assert.equal(resolution.proof.rejected_header_license_state, 'NY');
  assert.equal(resolution.evidence.declared_license_state, 'MT');
  assert.notEqual(resolution.evidence.declared_address, resolution.evidence.facility_address);
  assert.equal(resolution.evidence.pointerUrl,
    'https://www.sphealth.org/cms-hpt.txt');
});
