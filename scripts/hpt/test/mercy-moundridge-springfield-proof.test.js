'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Moundridge Mercy replaces Springfield archive with exact Kansas pointer file', () => {
  const { compliance, history } = loadReviewedView(audit);
  const row = compliance.find(item => item.ccn === '170780');
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(item => item.ccn === '170780');
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.domain, 'mercyh.org');
  assert.match(row.mrf_url, /mercy-hospital-ks_standardcharges\.csv/);
  assert.equal(row.mrf_last_updated, '2026-03-06');
  assert.match(history['170780'].mrf_url, /trinity-health\.org/);
  assert.equal(resolution.proof.rejected_header_license_state, 'MA');
  assert.equal(resolution.evidence.declared_license_state, 'KS');
  assert.equal(resolution.evidence.pointerUrl, 'https://www.mercyh.org/cms-hpt.txt');
});
