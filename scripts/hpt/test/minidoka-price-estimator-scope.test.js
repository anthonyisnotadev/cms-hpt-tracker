'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const proof = readJson('data/hpt-audit/reconciliation-minidoka-current-price-estimator-scope-proof-2026-09-27.json');
const manual = readJson('data/hpt-audit/reconciliation-manual-access-observations.json');
const worklist = readJson('data/hpt-audit/unresolved-investigation-worklist.json');

test('Minidoka price-search route is an estimate tool, not a promoted MRF or absence finding', () => {
  assert.equal(proof.ccn, '131319');
  assert.equal(proof.http_status, 200);
  assert.equal(proof.response_bytes, 154010);
  assert.equal(proof.response_sha256, '875e8a3c2ecdecab50b5b206338bffe5bfde33c94ca0b52cc7a613f588251cfb');
  assert.equal(proof.connected_browser_observation.visible_cms_mrf_download_link, false);
  assert.equal(proof.relationship_to_current_pointer.pointer_not_refetched, true);
  assert.equal(proof.disposition, 'first-party-estimator-route-confirmed-pointer-target-unavailable');
  assert.equal(proof.count_effect, 'none; retain CCN 131319 unresolved');
  assert.match(proof.finding, /not evidence that no current MRF exists/);

  const record = manual.records.find(row => row.ccn === '131319');
  assert.equal(record.latest_service_price_search_scope_review_2026_09_27.proof_file,
    'reconciliation-minidoka-current-price-estimator-scope-proof-2026-09-27.json');
  const queued = worklist.records.find(row => row.ccn === '131319');
  assert.match(queued.next_action, /Do not treat the 2020 Excel chargemaster or third-party price summary as the current MRF/);
});
