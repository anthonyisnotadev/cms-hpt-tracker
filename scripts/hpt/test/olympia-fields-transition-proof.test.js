'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView, applyResolutions } = require('../lib/reviewed-resolutions');
const { standingEvidenceRetained } = require('../lib/reconciliation-precedence');
const { classifyRow } = require('../build-interventions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-olympia-fields-transition-proof.json'));
const resolution = require(path.join(audit, 'reviewed-resolutions.json')).find(row => row.ccn === '140172');

test('new Olympia Fields operator pointer and JSON are retained without a current-template claim', () => {
  assert.equal(proof.prior_assigned_domain, 'franciscanhealth.org');
  assert.equal(proof.current_operator_domain, 'olympiafieldshospital.com');
  assert.equal(proof.declared_address, '20201 South Crawford Ave, Olympia Fields, IL 60461');
  assert.equal(proof.declared_date, '2026-07-24');
  assert.equal(proof.declared_version_literal, '3.0');
  assert.equal(proof.cms_json_schema_identifier, '3.0.0');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '140172');
  assert.equal(row.domain, 'olympiafieldshospital.com');
  assert.equal(row.finding, 'mrf-template-version-noncanonical');
  assert.equal(row.cms_template_version, '3.0');
  assert.equal(view.history['140172'].domain, 'franciscanhealth.org');
  assert.equal(classifyRow(row, null).intervention, 'file-template-version-review');
  assert.equal(standingEvidenceRetained(row.finding, 'mrf-request-unsuccessful'), true);
});

test('version review requires the exact observed and expected identifiers', () => {
  assert.throws(() => applyResolutions([resolution.base], [], [], [{ ...resolution,
    evidence: { ...resolution.evidence, expected_version: '3.0' } }]));
});
