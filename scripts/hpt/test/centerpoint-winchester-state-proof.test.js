'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Clark Regional rename preserves explicit NC-versus-KY MRF metadata conflict', () => {
  const proof = require(path.join(audit, 'reconciliation-centerpoint-winchester-state-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json')).find(row => row.ccn === '180092');
  assert.equal(proof.roster_name, 'CLARK REGIONAL MEDICAL CENTER');
  assert.equal(proof.declared_hospital_name.trim(), 'Clark Regional Medical Center');
  assert.equal(proof.declared_address.trim(), '175 Hospital Drive Winchester KY 40391');
  assert.equal(proof.facility_state, 'KY');
  assert.equal(proof.declared_license_state, 'NC');
  assert.equal(proof.declared_date, '2026-07-10');
  assert.equal(proof.declared_version, '3.0.0');
  assert.ok(proof.retained_bytes < proof.file_total_bytes);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.observedFinding, 'mrf-license-state-field-conflicts-facility');
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '180092');
  assert.equal(row.finding, 'mrf-license-state-field-conflicts-facility');
  assert.equal(row.mrf_url, proof.file_url);
  assert.equal(view.history['180092'].finding, 'not-assessed-not-named-in-file');
});
