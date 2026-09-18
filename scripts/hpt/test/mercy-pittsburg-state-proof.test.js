'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Mercy Pittsburg has a Kansas campus and an explicit OK license-field conflict', () => {
  const proof = require(path.join(audit, 'reconciliation-mercy-pittsburg-state-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === '170006');
  assert.equal(proof.roster_address, '1 MT CARMEL WAY');
  assert.equal(proof.facility_state, 'KS');
  assert.equal(proof.declared_hospital_name, 'Mercy Hospital Pittsburg Inc');
  assert.equal(proof.declared_address, '1 MT Carmel Way Pittsburg KS 66762');
  assert.equal(proof.declared_license_state_column, 'license_number | OK');
  assert.equal(proof.declared_license_state, 'OK');
  assert.equal(proof.declared_date, '2026-06-09');
  assert.equal(proof.declared_version, '3.0.0');
  assert.equal(proof.source_page_file_link_observed, false);
  assert.ok(proof.retained_bytes < proof.file_total_bytes);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.observedFinding, 'mrf-license-state-field-conflicts-facility');
  const view = loadReviewedView(audit);
  assert.equal(view.compliance.find(row => row.ccn === '170006').finding, 'mrf-license-state-field-conflicts-facility');
  assert.equal(view.history['170006'].finding, 'not-assessed-not-named-in-file');
});
