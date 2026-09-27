'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-lakeland-current-ahca-license-profile-browser-proof-2026-09-27.json'), 'utf8'));
const observations = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-manual-access-observations.json'), 'utf8')).records;
const queue = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-reconciliation-queue.json'), 'utf8'));
const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));

test('Lakeland current AHCA profile corroborates Florida license without hiding MRF field defects', () => {
  assert.equal(proof.ccn, '100157');
  assert.equal(proof.ahca_file_number, proof.ccn);
  assert.equal(proof.license_number, '4413');
  assert.equal(proof.license_status, 'LICENSED');
  assert.equal(proof.street_address, '1324 LAKELAND HILLS BLVD, LAKELAND, FL 33805');
  assert.match(proof.interpretation, /literal license_number_state CA/);
  assert.match(proof.interpretation, /Bouldevard/);

  const observation = observations.find(row => row.ccn === proof.ccn && row.proof_file
    === 'reconciliation-lakeland-current-ahca-license-profile-browser-proof-2026-09-27.json');
  assert.ok(observation, 'the browser evidence is in the manual observation ledger');
  assert.equal(observation.disposition, proof.disposition);
  assert.match(observation.next_action, /publisher-corrected MRF/);

  const review = queue.find(row => row.ccn === proof.ccn);
  assert.equal(review.workstream, 'standing-evidence-follow-up');
  assert.match(review.next_action, /publisher-corrected MRF/);
  assert.equal(verification.records.find(row => row.ccn === proof.ccn).standing_finding,
    'mrf-license-state-field-conflicts-facility');
});
