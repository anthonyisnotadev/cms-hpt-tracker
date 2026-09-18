'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const observations = require(path.join(root, 'data/hpt-audit/reconciliation-manual-access-observations.json')).records;
const queue = require(path.join(root, 'data/hpt-audit/nationwide-reconciliation-queue.json'));

test('Lakeland official PDF and insurer TiC links do not promote either same-address CCN', () => {
  for (const [ccn, role] of [['010125', 'acute-care-roster-record'], ['011311', 'critical-access-roster-record']]) {
    const o = observations.find(row => row.ccn === ccn);
    const q = queue.find(row => row.ccn === ccn);
    assert.equal(o.facility_role, role);
    assert.equal(o.pointer_http_status, 404);
    assert.match(o.pointer_browser_result, /Page Not Found/);
    assert.match(o.page_standard_charges_link, /\.pdf$/i);
    assert.match(o.page_insurer_tic_link_role, /not a hospital standard-charges MRF/);
    assert.equal(q.workstream, 'genuinely-unresolved-investigation');
    assert.equal(q.next_action, o.next_action);
  }
});
