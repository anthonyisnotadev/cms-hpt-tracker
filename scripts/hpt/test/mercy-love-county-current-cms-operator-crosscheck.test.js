'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('Mercy Love County current services supersede a stale closure inference but not the missing MRF finding', () => {
  const proof = read('reconciliation-mercy-love-county-current-operator-cms-crosscheck-2026-09-28.json');
  const manual = read('reconciliation-manual-access-observations.json').records.find(row => row.ccn === '371306');
  const worklist = read('unresolved-investigation-worklist.json').records.find(row => row.ccn === '371306');

  assert.equal(proof.cms_enrollment_snapshot.record.ccn, '371306');
  assert.equal(proof.cms_enrollment_snapshot.record.npi, '1649221557');
  assert.equal(proof.cms_enrollment_snapshot.record.address, '300 WANDA ST, MARIETTA, OK 73448-1200');
  assert.match(proof.cms_enrollment_snapshot.record.enrollment_state_field_semantics, /not an active\/terminated status/);
  assert.match(proof.first_party_operator_updates[0].operator_reported_status, /except inpatient care/);
  assert.match(proof.first_party_operator_updates[1].operator_reported_status, /August 1, 2026/);
  assert.equal(proof.current_official_site_routes.cms_hpt_pointer.http_status, 404);
  assert.equal(proof.current_official_site_routes.site_directory.price_transparency_or_cms_pointer_entry_found, false);
  assert.match(proof.reconciliation.hpt_disposition_effect, /none/);
  assert.equal(manual.latest_operator_cms_crosscheck_2026_09_28.proof_file,
    'reconciliation-mercy-love-county-current-operator-cms-crosscheck-2026-09-28.json');
  assert.equal(worklist.current_disposition, 'pointer-not-retrieved');
  assert.match(worklist.next_action, /corrected root cms-hpt\.txt/);
});
