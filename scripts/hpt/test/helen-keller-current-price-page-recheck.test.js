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
