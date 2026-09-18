'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Spring Harbor former name is matched without masking the older declared date', () => {
  const proof = require(path.join(audit, 'reconciliation-spring-harbor-stale-proof.json'));
  const resolutions = require(path.join(audit, 'reviewed-resolutions.json'));
  const resolution = resolutions.find(row => row.ccn === '204005');
  assert.equal(proof.roster_name, 'MAINEHEALTH BEHAVIORAL HEALTH AT SPRING HARBOR');
  assert.equal(proof.declared_location_name, 'Spring Harbor Hospital');
  assert.equal(proof.declared_address, '123 Andover Rd, Westbrook, ME 04092');
  assert.equal(proof.declared_license_state, 'ME');
  assert.equal(proof.declared_date, '2025-08-12');
  assert.ok(proof.age_days_at_observation > 365);
  assert.equal(proof.declared_version, '3.0.0');
  assert.ok(proof.retained_bytes < proof.file_total_bytes);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.observedFinding, 'mrf-stale-over-365-days');
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  assert.equal(view.compliance.find(row => row.ccn === '204005').finding, 'mrf-stale-over-365-days');
  assert.equal(view.history['204005'].finding, 'not-assessed-not-named-in-file');
});
