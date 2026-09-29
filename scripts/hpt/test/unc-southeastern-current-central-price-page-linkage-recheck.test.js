'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

test('current UNC parent-page file link corroborates provenance but 403 keeps 340050 unresolved', () => {
  const proof = read('data/hpt-audit/reconciliation-unc-southeastern-current-central-price-page-linkage-recheck-2026-09-28.json');
  assert.equal(proof.ccn, '340050');
  assert.equal(proof.official_current_price_page.same_as_retained_unc_southeastern_page_file_url, true);
  assert.equal(proof.file_access_recheck.http_status, 403);
  assert.equal(proof.file_access_recheck.file_bytes_received, false);
  assert.equal(proof.new_file_bytes, false);
  assert.equal(proof.disposition_changed, false);
  assert.equal(proof.unresolved_count_change, 0);

  const manual = read('data/hpt-audit/reconciliation-manual-access-observations.json').records;
  const observation = manual.find(row => row.ccn === '340050'
    && row.proof_file === 'reconciliation-unc-southeastern-current-central-price-page-linkage-recheck-2026-09-28.json');
  assert.ok(observation);
  assert.equal(observation.file_http_status, 403);
  assert.match(observation.next_action, /Obtain file bytes through a publisher-enabled route/);

  const cohort = read('data/hpt-audit/reconciliation-891-baseline-member-roster-2026-09-27.json');
  assert.ok(cohort.current_crosswalk_ccns['genuinely-unresolved'].includes('340050'));
});
