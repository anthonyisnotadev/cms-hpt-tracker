'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Sanford behavioral CCN gets only its own campus and MRF', () => {
  const proof = require(path.join(audit, 'reconciliation-sanford-behavioral-alias-proof.json'));
  const resolutions = require(path.join(audit, 'reviewed-resolutions.json'));
  const resolution = resolutions.find(row => row.ccn === '244018');
  assert.equal(proof.roster_name, 'SANFORD BEHAVIORAL HEALTH CENTER');
  assert.equal(proof.declared_hospital_name, 'Sanford Behavioral Health Thief River Falls');
  assert.equal(proof.declared_address, '120 Labree Ave S, Thief River Falls, MN 56701');
  assert.equal(proof.declared_license_state, 'MN');
  assert.equal(proof.declared_date, '2026-03-04');
  assert.equal(proof.declared_version, '3.0.0');
  assert.ok(proof.retained_bytes < proof.file_total_bytes);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '244018');
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.mrf_url, proof.file_url);
  assert.equal(view.history['244018'].finding, 'not-assessed-domain-unknown');
  assert.equal(view.compliance.filter(item => item.mrf_url === proof.file_url).length, 1);
});
