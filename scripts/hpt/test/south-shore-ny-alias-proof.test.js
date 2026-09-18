'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Southside historical CCN maps only to South Shore exact-campus ZIP', () => {
  const proof = require(path.join(audit, 'reconciliation-south-shore-ny-alias-proof.json'));
  const resolutions = require(path.join(audit, 'reviewed-resolutions.json'));
  const resolution = resolutions.find(row => row.ccn === '330043');
  assert.equal(proof.roster_name, 'NS/LIJ HS SOUTHSIDE HOSPITAL');
  assert.equal(proof.declared_hospital_name, 'South Shore University Hospital');
  assert.equal(proof.declared_location_name, 'South Shore University Hospital');
  assert.equal(proof.declared_address, '301 East Main St, Bay Shore, NY, 11706');
  assert.equal(proof.declared_license_state, 'NY');
  assert.equal(proof.declared_date, '2026-03-31');
  assert.equal(proof.declared_version, '3.0.0');
  assert.equal(proof.archive_member_kind, 'json');
  assert.ok(proof.retained_bytes < proof.file_total_bytes);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '330043');
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.mrf_url, proof.file_url);
  assert.equal(view.history['330043'].finding, 'not-assessed-not-named-in-file');
  assert.equal(view.compliance.filter(item => item.mrf_url === proof.file_url).length, 1);
});
