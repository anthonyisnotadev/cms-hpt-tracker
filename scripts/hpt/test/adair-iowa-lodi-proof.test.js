'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Adair Iowa replaces California Lodi file with Greenfield pointer file', () => {
  const { compliance, history } = loadReviewedView(audit);
  const row = compliance.find(item => item.ccn === '161310');
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(item => item.ccn === '161310');
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.domain, 'achsiowa.org');
  assert.match(row.mrf_url, /dbACMHDGREENFIELDIA/);
  assert.equal(row.mrf_last_updated, '2026-09-02');
  assert.match(history['161310'].mrf_url, /dbAHLMLODICA/);
  assert.equal(resolution.proof.rejected_header_license_state, 'CA');
  assert.equal(resolution.evidence.declared_license_state, 'IA');
});
