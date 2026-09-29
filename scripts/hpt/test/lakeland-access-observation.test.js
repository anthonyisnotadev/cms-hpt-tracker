'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const observations = require(path.join(root, 'data/hpt-audit/reconciliation-manual-access-observations.json')).records;
const queue = require(path.join(root, 'data/hpt-audit/nationwide-reconciliation-queue.json'));

test('Lakeland official PDF and insurer TiC links do not promote either same-address CCN', () => {
  for (const [ccn, role] of [['010125', 'acute-care-roster-record'], ['011311', 'critical-access-roster-record']]) {
    const history = observations.filter(row => row.ccn === ccn);
    const o = history.find(row => row.proof_file === 'reconciliation-lakeland-current-cah-scope-proof.json'
      || row.pointer_browser_result);
    const latest = history.sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at)).at(-1);
    const q = queue.find(row => row.ccn === ccn);
    assert.equal(o.facility_role, role);
    assert.equal(o.pointer_http_status, 404);
    assert.match(o.pointer_browser_result, /Page Not Found/);
    assert.match(o.page_standard_charges_link, /\.pdf$/i);
    assert.match(o.page_insurer_tic_link_role, /not a hospital standard-charges MRF/);
    assert.equal(q.workstream, 'genuinely-unresolved-investigation');
    assert.equal(q.next_action, latest.next_action);
    assert.equal(latest.proof_file, 'reconciliation-qies-unresolved-status-audit-2026-09-27.json');
    assert.match(latest.next_action, ccn === '010125' ? /through 2025-11-13/ : /current first-party pointer\/MRF/);
  }
});
