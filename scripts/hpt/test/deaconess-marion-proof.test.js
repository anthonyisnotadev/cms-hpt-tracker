'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-deaconess-marion-proof.json'));
const resolution = require(path.join(audit, 'reviewed-resolutions.json')).find(row => row.ccn === '140184');

test('Heartland roster campus is verified under current Deaconess name without cross-facility substitution', () => {
  assert.equal(proof.roster_address, '3333 W DEYOUNG');
  assert.equal(proof.current_hospital_name, 'Deaconess Illinois Medical Center');
  assert.equal(proof.declared_address, '3333 W. Deyoung St., Marion, IL 62959');
  assert.equal(proof.declared_license_state, 'IL');
  assert.equal(proof.declared_date, '2026-02-03');
  assert.equal(proof.declared_version, '3.0.0');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '140184');
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.domain, 'deaconess.com');
  assert.equal(row.mrf_url, proof.file_url);
  assert.equal(view.history['140184'].finding, 'not-assessed-not-named-in-file');
});
