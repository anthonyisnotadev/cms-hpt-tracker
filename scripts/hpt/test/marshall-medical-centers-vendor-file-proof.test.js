'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const audit = path.resolve(__dirname, '../../..', 'data/hpt-audit');

test('Marshall South retains independent vendor file evidence while pointer linkage is pending', () => {
  const proof = require(path.join(audit, 'reconciliation-marshall-medical-centers-south-current-vendor-file-proof.json'));
  const observation = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records
    .find(row => row.ccn === '010005');
  assert.equal(proof.file_http_status, 200);
  assert.equal(proof.file_bytes, 15724902);
  assert.equal(proof.declared_location_name, 'Marshall Medical Center South');
  assert.equal(proof.declared_address, '2505 US Hwy 431, Boaz, AL 35957');
  assert.equal(proof.declared_license_state, 'AL');
  assert.equal(observation.publisher_file_sha256, proof.file_sha256);
  assert.equal(observation.pointer_status, 'DNS resolution failed');
  assert.match(observation.disposition, /pointer-linkage-pending/);
});

test('Minidoka third-party pricing claim remains a non-promoted discovery lead', () => {
  const observation = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records
    .find(row => row.ccn === '131319');
  assert.equal(observation.latest_third_party_search_lead.file_url_observed, false);
  assert.equal(observation.latest_third_party_search_lead.bytes_retrieved, 0);
  assert.equal(observation.latest_third_party_search_lead.disposition, 'stage-lead-do-not-promote');
});
