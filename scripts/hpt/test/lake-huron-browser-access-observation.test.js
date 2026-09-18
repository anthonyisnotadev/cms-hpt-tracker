'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

test('Lake Huron browser access error remains historical after later exact-source proof', () => {
  const audit = path.resolve(__dirname, '../../../data/hpt-audit');
  const observation = require(path.join(audit, 'reconciliation-lake-huron-browser-access-observation.json'));
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === observation.ccn);
  assert.equal(observation.site_browser_result, 'rendered');
  assert.equal(observation.pointer_browser_result, 'net::ERR_BLOCKED_BY_CLIENT');
  assert.equal(observation.disposition, 'access-observation-only');
  assert.equal(row.mrf_url, 'https://mylakehuron.com/wp-content/uploads/2026/09/1060000015_LakeHuronMedicalCenter_standardcharges.json');
  assert.equal(row.finding, 'mrf-template-version-noncanonical');
  assert.match(observation.next_action, /exact current root-pointer body/);
});
