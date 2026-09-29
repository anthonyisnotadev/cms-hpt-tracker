const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-helen-keller-current-price-page-recheck-proof.json'), 'utf8'));

test('Helen Keller current page retains separate exact CSV lead without promotion', () => {
  assert.equal(proof.ccn, '010019');
  assert.equal(proof.linked_facility, 'Helen Keller Hospital');
  assert.match(proof.linked_mrf_url, /472323163_hellen-keller-hospital_standardcharges\.csv$/);
  assert.equal(proof.linked_mrf_fetch_status, 'transport-unverified');
  assert.equal(proof.disposition, 'facility-specific-page-and-file-lead-retained');
});

test('Helen Keller 2026-09-27 recheck distinguishes current linked URL from legacy 404 and retains uncertainty', () => {
  const latest = proof.latest_source_check_2026_09_27;
  assert.equal(latest.source_url, 'https://hh2026.cloudaccess.host/patients-visitors/price-transparency/');
  assert.equal(latest.page_content_last_updated, '2026-08-20');
  assert.match(latest.result, /separate standard-charge-file row/);
  assert.match(latest.result, /unexpected EOF before response bytes/);
  assert.match(latest.legacy_url_recheck, /returns HTTP 404/);
  assert.equal(latest.disposition, 'retain-unresolved-exact-facility-file-link-transport-unavailable');
  assert.match(latest.next_action, /Do not substitute the 404 legacy URL, Huntsville\/Red Bay files/);
  assert.match(latest.evidence_role, /no file bytes, metadata, pointer linkage, MRF promotion, or compliance conclusion/);
});
