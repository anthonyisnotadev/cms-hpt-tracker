'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Colorado Platte Valley does not retain Utah Heber file or promote inaccessible Colorado archive', () => {
  const { compliance, history } = loadReviewedView(audit);
  const row = compliance.find(item => item.ccn === '060004');
  const proof = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(item => item.ccn === '060004').proof;
  assert.equal(row.finding, 'not-assessed-identity-conflict');
  assert.equal(row.mrf_url, '');
  assert.equal(row.mrf_last_updated, '');
  assert.match(history['060004'].mrf_url, /heber-valley/);
  assert.equal(proof.rejected_header_license_state, 'UT');
  assert.equal(proof.pointer_location_name, 'Platte Valley Medical Center');
  assert.match(proof.pointer_mrf_url, /platte-valley-medical-center/);
  assert.notEqual(proof.rejected_mrf_url, proof.pointer_mrf_url);
  assert.match(proof.pointer_mrf_transport_error, /without file bytes/);
});
