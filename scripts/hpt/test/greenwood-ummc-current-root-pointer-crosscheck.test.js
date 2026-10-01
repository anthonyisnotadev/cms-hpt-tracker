'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = file => JSON.parse(fs.readFileSync(path.join(audit, file), 'utf8'));

test('current UMMC pointer adds exact publisher linkage evidence without assigning a sibling MRF to Greenwood', () => {
  const proofFile = 'reconciliation-greenwood-ummc-current-root-pointer-crosscheck-2026-09-29.json';
  const proof = read(proofFile);
  assert.equal(proof.ccn, '250099');
  assert.equal(proof.official_root_pointer.status, 200);
  assert.equal(proof.official_root_pointer.content_type, 'text/plain');
  assert.equal(proof.official_root_pointer.bytes, 1275);
  assert.equal(proof.official_root_pointer.sha256, '4e90bcdcd7db39a11b03a5b05c699373d9b3c54fa49af5ffeb841b0cd5aa5b6f');
  assert.deepEqual(proof.official_root_pointer.parsed_locations, [
    'UMMC Jackson Hospital', 'UMMC Grenada Hospital', 'UMMC Holmes County Hospital', 'UMMC Madison Hospital'
  ]);
  assert.equal(proof.official_root_pointer.parsed_mrf_urls.length, 4);
  assert.equal(proof.official_root_pointer.greenwood_entry_present, false);
  assert.deepEqual(proof.official_pricing_page.url,
    'https://umc.edu/Healthcare/Patients-and-Visitors/Bill%20Pay/UMMC%20Pricing.html');
  assert.match(proof.official_pricing_page.browser_observation, /no Greenwood/i);
  assert.equal(proof.comparison_to_2026_09_26.previous_pointer_observation, 'web-tool-inaccessible');
  assert.match(proof.comparison_to_2026_09_26.evidence_gain, /first complete, content-bearing/);
  assert.equal(proof.disposition, 'current-ummc-pointer-and-pricing-page-omit-greenwood-specific-mrf');
  assert.equal(proof.count_effect, 'none; CCN 250099 remains unresolved');
  assert.equal(JSON.stringify(proof).includes('@'), false, 'do not retain pointer contact values');
  assert.equal(JSON.stringify(proof).includes('Lynn Christy'), false, 'do not retain pointer contact names');

  const manual = read('reconciliation-manual-access-observations.json');
  assert.ok(manual.records.some(row => row.ccn === proof.ccn && row.proof_file === proofFile
    && row.latest_ummc_root_pointer_recheck.sha256 === proof.official_root_pointer.sha256
    && row.latest_ummc_root_pointer_recheck.greenwood_entry_present === false));
  const browser = read('nationwide-browser-reviews.json');
  assert.ok(browser.records.some(row => row.ccn === proof.ccn && row.proof_file === proofFile
    && row.kind === 'official-root-pointer-current-full-retrieval'
    && row.status === 'content-bearing-current-pointer-retrieved-greenwood-entry-omitted'));

  const roster = read('reconciliation-891-baseline-member-roster-2026-09-27.json');
  assert.ok(roster.baseline_unresolved_ccns.includes(proof.ccn));
  assert.ok(roster.current_crosswalk_ccns['genuinely-unresolved'].includes(proof.ccn));
  assert.equal(roster.summary.current_effective_categories['genuinely-unresolved'], 541);
  const worklist = read('unresolved-investigation-worklist.json');
  assert.ok(worklist.records.some(row => row.ccn === proof.ccn
    && row.current_disposition === 'pointer-facility-match-unresolved'));
});
