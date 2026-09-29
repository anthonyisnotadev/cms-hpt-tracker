'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const observations = require('../../../data/hpt-audit/reconciliation-manual-access-observations.json');
const { loadReviewedView } = require('../lib/reviewed-resolutions');
const path = require('path');

const root = path.resolve(__dirname, '../../..');

test('HSS page-pointer agreement does not promote denied file', () => {
  const observation = observations.records.find(row => row.ccn === '330270');
  assert.equal(observation.pointer_and_first_party_page_link_same_file, true);
  assert.equal(observation.prior_browser_file_status, 'http-denied');
  assert.match(observation.next_action, /materially different authorized download route/);
  const view = loadReviewedView(path.join(root, 'data/hpt-audit'));
  const row = view.compliance.find(item => item.ccn === '330270');
  assert.equal(row.finding, 'not-assessed-nationwide-mrf-request-unsuccessful');
});
