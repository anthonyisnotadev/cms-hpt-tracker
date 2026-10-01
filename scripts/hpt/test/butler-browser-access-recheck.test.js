'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Butler browser access retry records the exact first-party link without implying bytes or resolving HPT', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-butler-current-page-proof.json'), 'utf8'));
  const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'))
    .records.find(record => record.ccn === '390168');
  const observation = proof.browser_access_recheck_2026_09_29;

  assert.equal(observation.browser_surface, 'Codex in-app browser');
  assert.equal(observation.official_pricing_page_rendered, true);
  assert.equal(observation.official_page_link_url, proof.page_linked_file_url);
  assert.equal(observation.browser_attempt_url, proof.page_linked_file_url);
  assert.equal(observation.browser_result, 'net::ERR_BLOCKED_BY_CLIENT');
  assert.equal(observation.csv_bytes_received, false);
  assert.equal(observation.disposition_changed, false);
  assert.match(observation.interpretation, /does not establish file absence/i);
  assert.ok(manual);
  assert.equal(manual.latest_browser_file_access_recheck_2026_09_29.proof_file,
    'reconciliation-butler-current-page-proof.json');
  assert.equal(manual.next_action, observation.next_action);
  assert.match(manual.next_action, /Do not retry the unchanged direct request or in-app browser URL/);
  assert.equal(manual.disposition, 'official-page-and-exact-file-link-confirmed-bytes-blocked');
});
