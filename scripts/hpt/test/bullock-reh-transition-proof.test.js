'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../../..');
const proof = require(path.join(root, 'data/hpt-audit/reconciliation-bullock-reh-transition-proof.json')).record;
const observations = require(path.join(root, 'data/hpt-audit/reconciliation-manual-access-observations.json')).records;
const queue = require(path.join(root, 'data/hpt-audit/nationwide-reconciliation-queue.json'));

test('Bullock current REH proof does not silently migrate to historical acute-care CCN', () => {
  assert.equal(proof.ccn_current_rural_emergency_hospital, '010779');
  assert.equal(proof.ccn_earlier_acute_care_hospital, '010110');
  assert.match(proof.pointer_location_name, /Rural Emergency Hospital/);
  assert.match(proof.declared_address, /Union Springs, AL 36089/);
  assert.equal(proof.declared_license_state, 'CA');
  const sample = fs.readFileSync(path.join(root, proof.file_retained_sample));
  assert.equal(sample.length, 262144);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.file_sample_sha256);
  for (const [ccn, role] of [['010110', 'historical-acute-care-hospital'], ['010779', 'current-rural-emergency-hospital']]) {
    const observation = observations.find(row => row.ccn === ccn);
    const reconciliation = queue.find(row => row.ccn === ccn);
    assert.equal(observation.facility_role, role);
    assert.equal(reconciliation.workstream, 'genuinely-unresolved-investigation');
    assert.equal(reconciliation.manual_access_observation.facility_role, role);
    assert.equal(reconciliation.next_action, observation.next_action);
  }
});
