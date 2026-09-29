'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Atchison supersedes Kentucky file with page-only Kansas file', () => {
  const { compliance, history } = loadReviewedView(audit);
  const row = compliance.find(item => item.ccn === '171382');
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(item => item.ccn === '171382');
  assert.equal(row.finding, 'official-page-mrf-root-pointer-unavailable');
  assert.equal(row.domain, 'amberwellhealth.org');
  assert.match(row.mrf_url, /dbAHAATCHISONKS/);
  assert.equal(row.mrf_last_updated, '2026-08-18');
  assert.match(history['171382'].mrf_url, /dbCentralBaptistLexingtonKY/);
  assert.equal(resolution.evidence.pointerHttpStatus, 403);
  assert.equal(resolution.proof.rejected_header_license_state, 'KY');
  assert.equal(resolution.evidence.declared_license_state, 'KS');
  assert.notEqual(resolution.evidence.pointerUrl, resolution.evidence.url);
});
