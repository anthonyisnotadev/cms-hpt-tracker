'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Tucson St. Marys does not retain Waterbury file or promote page-only lead', () => {
  const { compliance, history } = loadReviewedView(audit);
  const row = compliance.find(item => item.ccn === '030010');
  assert.equal(row.finding, 'not-assessed-identity-conflict');
  assert.equal(row.domain, 'carondelet.org');
  assert.equal(row.mrf_url, '');
  assert.equal(row.pointer_url, '');
  assert.equal(row.mrf_last_updated, '');
  assert.match(history['030010'].mrf_url, /trinity-health\.org/);
  const proof = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(item => item.ccn === '030010').proof;
  assert.equal(proof.rejected_header_license_state, 'CT');
  assert.equal(proof.page_linked_header_license_state, 'AZ');
  assert.match(proof.page_linked_header_address, /1601 W St Marys Rd/);
  assert.equal(proof.root_pointer_http_status, 403);
  assert.notEqual(proof.rejected_mrf_url, proof.page_linked_mrf_url);
});
