'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../../..');
const proofPath = path.join(root, 'data/hpt-audit/reconciliation-howard-county-hpi-file-proof.json');

test('Howard County HPI evidence is identity-matched but remains non-pointer-linked', () => {
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(proof.ccn, '281338');
  assert.equal(proof.official_domain, 'hcmc.us.com');
  assert.match(proof.source_page_url, /hospitalpriceindex\.com\/hpi2\/machineReadable/);
  assert.equal(proof.declared_address, '1113 Sherman Street, St. Paul, NE 68873');
  assert.equal(proof.declared_state, 'NE');
  assert.equal(proof.version, '3.0.0');
  assert.equal(sample.length, 262144);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.current_mrf_sha256);
  assert.match(proof.next_action, /complete-file usability/);
});
