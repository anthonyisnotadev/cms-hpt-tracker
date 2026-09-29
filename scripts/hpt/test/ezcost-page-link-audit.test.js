'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');
const report = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-ezcost-page-link-audit.json'), 'utf8'));

test('EZCOST link audit covers the current pointer cohort without contact data', () => {
  const corpus = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv'), 'utf8'));
  const cohort = corpus.filter(row => /^https?:\/\/(?:www\.)?ezcost\.info\//i.test(row.source_page_url || ''));
  assert.equal(report.pointer_entries, cohort.length);
  assert.equal(report.records.length, cohort.length);
  assert.equal(Object.values(report.counts).reduce((sum, count) => sum + count, 0), cohort.length);
  assert.ok(!JSON.stringify(report).includes('contact_email'));
  assert.ok(!JSON.stringify(report).includes('contact_name'));
});

test('Taylor page target is explicitly different and cannot be inferred as a Taylor file', () => {
  const row = report.records.find(record => record.location_name === 'Taylor Regional Hospital');
  assert.equal(row.relationship, 'page-download-differs-from-pointer');
  assert.match(row.pointer_mrf_url, /TaylorRegionalHospital_standardcharges\.json$/);
  assert.match(row.page_downloads[0].url, /Self-Regional-Healthcare-Partners_standardcharges\.csv$/);
});
