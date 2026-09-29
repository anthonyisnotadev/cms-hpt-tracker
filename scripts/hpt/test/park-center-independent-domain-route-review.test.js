'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const auditDir = path.join(root, 'data/hpt-audit');
const read = (name) => JSON.parse(fs.readFileSync(path.join(auditDir, name), 'utf8'));

test('Park Center state/site evidence does not assign a Parkview sibling MRF or resolve CCN 154060', () => {
  const proofName = 'reconciliation-park-center-independent-domain-route-review-2026-09-28.json';
  const proof = read(proofName);
  const manual = read('reconciliation-manual-access-observations.json').records.find((row) => row.ccn === '154060');
  const browser = read('nationwide-browser-reviews.json').records.find((row) => row.proof_file === proofName);
  const queue = read('unresolved-investigation-worklist.json').records.find((row) => row.ccn === '154060');

  assert.equal(proof.state_source_observation.classification, 'State licensed and Medicare certified');
  assert.equal(proof.state_source_observation.hospital_address, '1909 CAREW STREET, FORT WAYNE, IN 46805');
  assert.equal(proof.browser_observation.final_url, 'https://www.parkview.com/');
  assert.equal(proof.browser_observation.http_status_observed, false);
  assert.equal(proof.current_parkview_pricing_page_observation.mrf_links_observed, 11);
  assert.equal(proof.current_parkview_pricing_page_observation.park_center_or_1909_carew_link_observed, false);
  assert.equal(proof.disposition_effect, 'none');
  assert.equal(proof.count_effect, 'none');
  assert.ok(manual);
  assert.equal(manual.observed_at, proof.observed_at);
  assert.equal(manual.proof_file, proofName);
  assert.match(manual.next_action, /do not borrow any of the 11 other Parkview location files/i);
  assert.match(manual.next_action, /Do not infer coverage from the shared state-license listing or domain redirect/);
  assert.ok(browser);
  assert.equal(browser.ccn, '154060');
  assert.ok(queue);
  assert.equal(queue.current_disposition, 'pointer-facility-match-unresolved');
  assert.match(queue.next_action, /do not borrow any of the 11 other Parkview location files/i);
  assert.match(queue.next_action, /Do not infer coverage from the shared state-license listing or domain redirect/);
});
