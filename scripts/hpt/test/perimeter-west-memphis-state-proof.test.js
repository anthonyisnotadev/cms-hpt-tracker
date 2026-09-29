'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-perimeter-west-memphis-state-proof.json')));

test('West Memphis proof binds the complete pointer-linked CSV to the Arkansas facility but preserves the TX field conflict', () => {
  const bytes = fs.readFileSync(path.join(root, proof.retained_complete_file));
  assert.equal(bytes.length, proof.retained_bytes);
  assert.equal(bytes.length, 4029);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), proof.file_sha256);
  assert.equal(proof.pointer_location_name, 'Woodridge of West Memphis LLC');
  assert.match(proof.declared_address, /600 North 7th Street, West Memphis 72301/);
  assert.equal(proof.declared_license_state, 'TX');
  assert.equal(proof.facility_state, 'AR');
  assert.equal(proof.version, '3.0.0');
  const resolution = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json')))
    .find(row => row.ccn === '044021');
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.fileSha256, proof.file_sha256);
  assert.equal(resolution.evidence.observedFinding, 'mrf-license-state-field-conflicts-facility');
  assert.doesNotMatch(resolution.note, /compliant|noncompliant/i);
  const current = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'))).records
    .find(row => row.ccn === '044021');
  assert.equal(current.standing_finding, 'mrf-license-state-field-conflicts-facility');
  assert.equal(current.latest_observation_superseded, true);
});
