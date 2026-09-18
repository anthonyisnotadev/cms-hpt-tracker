'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Dickinson exact-campus alias keeps distinct pricing and pointer URLs', () => {
  const proof = require(path.join(audit, 'reconciliation-dickinson-alias-proof.json'));
  const resolutions = require(path.join(audit, 'reviewed-resolutions.json'));
  const resolution = resolutions.find(row => row.ccn === '230055');
  assert.equal(proof.roster_name, 'DICKINSON COUNTY MEMORIAL HOSPITAL');
  assert.equal(proof.declared_hospital_name, 'Marshfield Medical Center - Dickinson');
  assert.equal(proof.declared_address, '1721 South Stephenson Avenue, Iron Mountain, MI 49801');
  assert.equal(proof.declared_license_state, 'MI');
  assert.equal(proof.declared_date, '2026-02-19');
  assert.equal(proof.declared_version, '3.0.0');
  assert.notEqual(proof.page_file_url, proof.file_url);
  assert.equal(proof.page_file_sample_sha256, proof.sample_sha256);
  assert.ok(proof.retained_bytes < proof.file_total_bytes);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  assert.equal(view.compliance.find(row => row.ccn === '230055').finding, 'compliant-observed');
  assert.equal(view.history['230055'].finding, 'not-assessed-not-named-in-file');
});
