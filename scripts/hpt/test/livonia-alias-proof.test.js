'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Livonia historical CCN follows exact Trinity campus and ZIP', () => {
  const proof = require(path.join(audit, 'reconciliation-livonia-alias-proof.json'));
  const resolutions = require(path.join(audit, 'reviewed-resolutions.json'));
  const resolution = resolutions.find(row => row.ccn === '230002');
  assert.equal(proof.roster_name, 'ST JOE MERCY HOSPITAL SYSTEM LIVONIA');
  assert.equal(proof.declared_hospital_name, 'St Mary Mercy Livonia');
  assert.equal(proof.declared_address, '36475 Five Mile Rd, Livonia, MI 48154');
  assert.equal(proof.declared_license_state, 'MI');
  assert.equal(proof.declared_date, '2026-03-31');
  assert.equal(proof.declared_version, '3.0.0');
  assert.equal(proof.archive_member_kind, 'csv');
  assert.ok(proof.retained_bytes < proof.file_total_bytes);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '230002');
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.mrf_url, proof.file_url);
  assert.equal(view.history['230002'].finding, 'not-assessed-not-named-in-file');
  assert.equal(view.compliance.filter(item => item.mrf_url === proof.file_url).length, 1);
});
