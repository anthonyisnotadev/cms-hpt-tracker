'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const proof = require(path.join(root, 'data/hpt-audit/reconciliation-freeman-northwest-transition-proof.json'));
const queue = require(path.join(root, 'data/hpt-audit/nationwide-reconciliation-queue.json'));

test('Freeman Northwest transition preserves separate unresolved Arkansas facilities', () => {
  assert.equal(proof.old_pointer_head_http_status, 301);
  assert.equal(proof.old_pointer_location_header, 'https://www.freemanhealthnw.comcms-hpt.txt');
  assert.equal(proof.new_arkansas_pointer_head_http_status, 404);
  assert.match(proof.new_arkansas_pointer_page_title, /404 \| Page Not Found/);
  assert.equal(proof.system_pointer_arkansas_entry_present, false);
  assert.equal(proof.facilities.length, 2);
  for (const [ccn, city] of [['040001', 'Siloam Springs'], ['040022', 'Springdale']]) {
    const facility = proof.facilities.find(item => item.ccn === ccn);
    const row = queue.find(item => item.ccn === ccn);
    assert.match(facility.official_address, new RegExp(city));
    assert.equal(row.workstream, 'genuinely-unresolved-investigation');
    assert.equal(row.manual_access_observation.proof_file, 'reconciliation-freeman-northwest-transition-proof.json');
    assert.match(row.next_action, new RegExp(city));
  }
});
