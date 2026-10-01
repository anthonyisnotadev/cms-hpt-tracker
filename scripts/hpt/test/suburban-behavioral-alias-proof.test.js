'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Suburban former-name campus remains distinct from Roxborough and records a formatting-only 3.0 version as current', () => {
  const proof = require(path.join(audit, 'reconciliation-suburban-behavioral-alias-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === '390116');
  assert.equal(proof.roster_name, 'SUBURBAN COMMUNITY HOSPITAL');
  assert.equal(proof.first_party_former_name_phrase, 'formerly known as Suburban Community Hospital');
  assert.equal(proof.roster_address, '2701 DEKALB PIKE');
  assert.match(proof.declared_location_names, /Suburban Behavioral Health Campus of Roxborough Memorial Hospital/);
  assert.match(proof.declared_addresses, /2701 DeKalb Pike East Norriton, PA  19401/);
  assert.equal(proof.declared_license_state, 'PA');
  assert.equal(proof.declared_date, '2026-09-01');
  assert.equal(proof.declared_version, '3.0');
  assert.equal(proof.expected_version, '3.0.0');
  assert.equal(proof.sibling_file_sample_sha256, proof.sample_sha256);
  assert.ok(proof.retained_bytes < proof.file_total_bytes);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.observedFinding, 'mrf-template-version-noncanonical');
  const view = loadReviewedView(audit);
  assert.equal(view.compliance.find(row => row.ccn === '390116').finding, 'compliant-observed');
  assert.equal(view.history['390116'].finding, 'not-assessed-not-named-in-file');
});
