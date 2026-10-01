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
const reconciliationRecords = require(path.join(root, 'data/hpt-audit/nationwide-reconciliation.json')).records;

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
    const history = observations.filter(row => row.ccn === ccn);
    const observation = history.find(row => row.facility_role === role);
    const latest = history.sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at)).at(-1);
    const reconciliation = (queue.find(row => row.ccn === ccn)
      || reconciliationRecords.find(row => row.ccn === ccn));
    if (ccn === '010110') {
      assert.equal(reconciliation.workstream, 'genuinely-unresolved-investigation');
      assert.equal(observation.facility_role, role);
      assert.equal(reconciliation.manual_access_observation.proof_file, latest.proof_file);
      assert.equal(reconciliation.next_action, latest.next_action);
      assert.match(latest.next_action, /historical CMS-format MRF\/pointer evidence/);
      assert.match(latest.next_action, /do not repeat the current pointer/);
    } else {
      assert.equal(reconciliation.workstream, 'consistent');
      assert.equal(reconciliation.manual_access_observation.disposition, 'verified-stale-mrf');
    }
  }
});
