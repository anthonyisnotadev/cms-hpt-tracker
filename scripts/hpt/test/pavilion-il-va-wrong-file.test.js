'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Champaign Pavilion excludes Williamsburg pointer and file without access verdict', () => {
  const { compliance, history } = loadReviewedView(audit);
  const row = compliance.find(item => item.ccn === '144029');
  const proof = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(item => item.ccn === '144029').proof;
  assert.equal(row.finding, 'not-assessed-identity-conflict');
  assert.equal(row.domain, 'pavilionhospital.com');
  assert.equal(row.pointer_url, '');
  assert.equal(row.mrf_url, '');
  assert.equal(row.mrf_last_updated, '');
  assert.match(history['144029'].mrf_url, /pavilionwp\.com/);
  assert.equal(proof.rejected_header_license_state, 'VA');
  assert.equal(proof.illinois_root_pointer_http_status, 403);
  assert.equal(proof.in_app_browser_root_text, 'Performing security verification');
});
