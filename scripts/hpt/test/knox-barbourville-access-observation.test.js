'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const observations = require('../../../data/hpt-audit/reconciliation-manual-access-observations.json').records;
const { loadReviewedView } = require('../lib/reviewed-resolutions');

test('Knox-Barbourville alias uses current pointer-linked full MRF and CMS enrollment proof', () => {
  const record = observations.find(row => row.ccn === '181328');
  assert.equal(record.mrf_total_bytes, 10723055);
  assert.equal(record.columns, 27);
  assert.equal(record.data_rows, 52260);
  assert.equal(record.malformed_row_widths, 0);
  assert.equal(record.cms_enrollment_matches.ccn, '181328');
  assert.equal(record.cms_enrollment_matches.npi, '1992176655');
  const view = loadReviewedView(path.resolve(__dirname, '../../../data/hpt-audit'));
  const row = view.compliance.find(item => item.ccn === '181328');
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.mrf_url, record.mrf_url);
  assert.equal(row.mrf_last_updated, '2026-01-01');
});
