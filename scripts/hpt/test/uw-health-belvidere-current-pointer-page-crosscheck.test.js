'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-uw-health-belvidere-current-price-page-pointer-url-crosscheck-2026-09-29.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-manual-access-observations.json'), 'utf8')).records;
const worklist = JSON.parse(fs.readFileSync(path.join(audit,
  'unresolved-investigation-worklist.json'), 'utf8'));

test('current UW page crosswalk binds the cached pointer URL to Belvidere without assigning a CCN', () => {
  const observation = manual.find(record => record.ccn === '140228'
    && record.latest_live_price_page_pointer_url_crosscheck);
  const check = observation?.latest_live_price_page_pointer_url_crosscheck;
  assert.ok(check, 'dated manual observation exists');
  assert.equal(check.proof_file, path.basename(path.join(audit,
    'reconciliation-uw-health-belvidere-current-price-page-pointer-url-crosscheck-2026-09-29.json')));
  assert.equal(check.current_belvidere_file_url, check.current_pointer_corpus_file_url);
  assert.equal(check.exact_url_match, true);
  assert.equal(check.page_link_label, 'Belvidere Hospital');
  assert.equal(check.browser_file_access, 'net::ERR_BLOCKED_BY_CLIENT; no bytes retrieved');
  assert.equal(proof.file_bytes_retrieved_this_review, false);
  assert.equal(proof.disposition_effect, 'none; retain CCN 140228 unresolved');

  const queued = worklist.records.find(record => record.ccn === '140228');
  assert.ok(queued, 'CCN remains in the nationwide unresolved worklist');
  assert.equal(queued.current_disposition, 'pointer-facility-match-unresolved');
  assert.equal(queued.candidate_file_recorded, true);
  assert.match(queued.next_action, /exact bytes for the current Belvidere-labeled Bynder URL/);
  assert.match(queued.next_action, /Do not assign by common ownership/);
});
