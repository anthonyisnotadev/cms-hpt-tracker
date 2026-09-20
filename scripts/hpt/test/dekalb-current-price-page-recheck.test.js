const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-dekalb-current-price-page-recheck-proof.json'), 'utf8'));

test('DeKalb current price page retains exact CSV lead without file promotion', () => {
  assert.equal(proof.ccn, '010012');
  assert.equal(proof.facility_identity, 'DeKalb Regional Medical Center');
  assert.match(proof.facility_address, /Fort Payne, AL/);
  assert.equal(proof.page_declared_price_date, '2026-08-20');
  assert.equal(proof.linked_mrf_fetch_status, 'dns-unresolved');
  assert.equal(proof.disposition, 'facility-specific-page-and-file-lead-retained');
});
