'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const observations = require('../../../data/hpt-audit/reconciliation-manual-access-observations.json').records;
const { loadReviewedView } = require('../lib/reviewed-resolutions');

test('Knox-Barbourville alias remains unresolved without current ARH file bytes', () => {
  const record = observations.find(row => row.ccn === '181328');
  assert.equal(record.roster_address, '80 Hospital Drive, Barbourville, KY 40906');
  assert.match(record.official_former_name_web_reader_observation, /formerly Knox County Hospital/);
  assert.match(record.cached_pointer_file_url, /Barbourville-ARH-Hospital_standardcharges\.csv$/);
  assert.match(record.in_app_browser_file_result, /ERR_NAME_NOT_RESOLVED/);
  assert.match(record.next_action, /Do not infer file absence/);
  const view = loadReviewedView(path.resolve(__dirname, '../../../data/hpt-audit'));
  assert.equal(view.compliance.find(row => row.ccn === '181328').mrf_url, '');
});
