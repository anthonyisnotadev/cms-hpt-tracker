'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');
const { classifyRow } = require('../build-interventions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-saint-mary-nazareth-proof.json'));
const resolution = require(path.join(audit, 'reviewed-resolutions.json')).find(row => row.ccn === '140180');

test('Saint Mary current operator proof retains exact campus and version uncertainty', () => {
  assert.equal(proof.prior_assigned_domain, 'healthcare.ascension.org');
  assert.equal(proof.current_operator_domain, 'saintmaryofnazarethhospital.com');
  assert.equal(proof.declared_address, '2233 W. Division St., Chicago, Illinois 60622');
  assert.equal(proof.declared_license_state, 'IL');
  assert.equal(proof.declared_date, '2026-09-01');
  assert.equal(proof.declared_version_literal, '3.0');
  assert.equal(proof.cms_json_schema_identifier, '3.0.0');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '140180');
  assert.equal(row.domain, 'saintmaryofnazarethhospital.com');
  assert.equal(row.finding, 'mrf-template-version-noncanonical');
  assert.equal(row.cms_template_version, '3.0');
  assert.equal(view.history['140180'].domain, 'healthcare.ascension.org');
  assert.equal(classifyRow(row, null).intervention, 'file-template-version-review');
});
