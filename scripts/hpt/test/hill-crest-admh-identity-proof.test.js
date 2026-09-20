const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-hill-crest-admh-identity-proof.json'), 'utf8'));

test('Hill Crest state directory corroborates identity without MRF promotion', () => {
  assert.equal(proof.ccn, '014000');
  assert.equal(proof.facility_name, 'Hill Crest Behavioral Health Services');
  assert.match(proof.facility_address, /Birmingham, AL 35212/);
  assert.equal(proof.disposition, 'official-identity-corroborated-no-mrf-promotion');
});
