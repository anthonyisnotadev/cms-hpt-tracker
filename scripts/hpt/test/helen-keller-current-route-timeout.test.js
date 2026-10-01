'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-helen-keller-current-route-timeout-2026-09-28.json'), 'utf8'));
const pageProof = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-helen-keller-current-price-page-recheck-proof.json'), 'utf8'));
const browser = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-browser-reviews.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'))
  .records.find(row => row.ccn === '010019');

test('Helen Keller current page-linked CSV timeout remains transport-only and does not promote or downgrade', () => {
  assert.equal(proof.ccn, '010019');
  assert.equal(proof.request.response_bytes_obtained, false);
  assert.equal(proof.disposition, 'official-page-linked-facility-file-transport-unavailable');
  assert.equal(proof.count_effect, 0);
  assert.match(proof.next_action, /publisher-provided copy|publisher-confirmed alternate/);
  assert.equal(manual.latest_range_get_timeout_2026_09_28.proof_file,
    'reconciliation-helen-keller-current-route-timeout-2026-09-28.json');
  assert.ok(browser.records.some(row => row.ccn === '010019'
    && row.kind === 'official-file-range-get-timeout'
    && row.bytes_read === 0));
  assert.doesNotMatch(JSON.stringify(proof), /MRF is absent|noncompliant/i);
  assert.equal(pageProof.latest_connected_browser_recheck_2026_09_29.original_recorded_observed_at,
    '2026-09-29T15:02:00Z');
  assert.equal(pageProof.latest_connected_browser_recheck_2026_09_29.observed_at, '2026-09-29');
  assert.match(pageProof.latest_connected_browser_recheck_2026_09_29.timestamp_integrity, /future-dated/);
  const currentBrowser = pageProof.latest_ordinary_browser_recheck_2026_09_30_1743_utc;
  assert.equal(currentBrowser.browser_result, 'ERR_NAME_NOT_RESOLVED');
  assert.equal(currentBrowser.origin_http_response, false);
  assert.equal(currentBrowser.page_or_file_bytes, 0);
  assert.equal(currentBrowser.new_evidence_gain, false);
  assert.equal(currentBrowser.disposition_effect, 'none');
  assert.match(currentBrowser.next_action, /Wait for DNS\/access recovery/);
});
