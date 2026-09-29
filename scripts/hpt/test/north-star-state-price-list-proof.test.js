const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-north-star-state-price-list-proof.json'), 'utf8'));

test('North Star state directory corroborates facility-specific price-list lead without MRF promotion', () => {
  assert.equal(proof.ccn, '024001');
  assert.equal(proof.state_source_facility, 'North Star Behavioral / North Star Hospital');
  assert.match(proof.state_source_address, /2530 Debarr Road/);
  assert.equal(proof.price_list_fetch_status, 403);
  assert.equal(proof.disposition, 'identity-and-price-list-lead-corroborated-no-mrf-promotion');
});
