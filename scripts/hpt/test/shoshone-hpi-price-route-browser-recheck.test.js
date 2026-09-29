'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const auditDir = path.join(root, 'data', 'hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(auditDir, name), 'utf8'));
const proof = read('reconciliation-shoshone-current-hpi-price-route-browser-recheck-2026-09-27.json');
const manual = read('reconciliation-manual-access-observations.json');
const browser = read('nationwide-browser-reviews.json');
const nationwide = read('nationwide-verification.json');
const worklist = read('unresolved-investigation-worklist.json');

test('Shoshone HPI browser route remains separate from its pointer-declared MRF', () => {
  assert.equal(proof.ccn, '131314');
  assert.equal(proof.classification, 'dated browser recheck; no new MRF recovery; no disposition change');
  assert.equal(proof.browser_observation.http_status_observed, false);
  assert.match(proof.browser_observation.rendered_result, /404 - Page Not Found/);
  assert.equal(proof.browser_observation.mrf_bytes_observed, 0);
  assert.equal(proof.current_pointer_context.previous_exact_target_status, 404);
  assert.notEqual(
    proof.browser_observation.visible_price_transparency_link,
    proof.current_pointer_context.pointer_declared_mrf_url
  );

  const observed = manual.records.find(row => row.ccn === '131314'
    && row.latest_browser_hpi_price_route_recheck_2026_09_27);
  assert.ok(observed, 'manual provenance retains the dated browser observation');
  assert.equal(observed.latest_browser_hpi_price_route_recheck_2026_09_27.disposition,
    'unresolved-current-pointer-target-and-vendor-price-route-unavailable');
  assert.match(observed.next_action, /Do not retry the unchanged HPI routes/);

  const browserRow = browser.records.find(row => row.proof_file === 'reconciliation-shoshone-current-hpi-price-route-browser-recheck-2026-09-27.json');
  assert.ok(browserRow, 'nationwide browser inventory links the proof');
  assert.equal(browserRow.http_status, null, 'the browser rendered a 404 page but did not expose HTTP status');
  assert.equal(new URL(browserRow.mrf_url).hostname,
    new URL(proof.current_pointer_context.pointer_declared_mrf_url).hostname);

  assert.ok(nationwide.records.some(row => row.ccn === '131314'), 'CCN remains in the full snapshot');
  assert.ok(worklist.records.some(row => row.ccn === '131314'), 'unresolved historical investigation remains queued');
});
