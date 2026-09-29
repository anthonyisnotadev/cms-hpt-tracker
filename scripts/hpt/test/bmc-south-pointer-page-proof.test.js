'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView, applyResolutions } = require('../lib/reviewed-resolutions');
const { classifyRow } = require('../build-interventions');
const { standingEvidenceRetained } = require('../lib/reconciliation-precedence');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-bmc-south-pointer-page-proof.json'));
const resolution = require(path.join(audit, 'reviewed-resolutions.json')).find(row => row.ccn === '220111');

test('BMC South rename and two distinct file versions remain separate', () => {
  assert.equal(proof.roster_name, 'GOOD SAMARITAN MEDICAL CENTER');
  assert.equal(proof.current_hospital_name, 'Boston Medical Center South');
  assert.equal(proof.pointer_file_declared_address, '235 North Pearl Street, Brockton MA 02301');
  assert.equal(proof.pointer_file_declared_state, 'MA');
  assert.equal(proof.pointer_file_declared_date, '2026-03-13');
  assert.equal(proof.pointer_file_declared_version, '3.0.0');
  assert.equal(proof.pricing_page_file_declared_date, '2025-01-15');
  assert.equal(proof.pricing_page_file_declared_version, '2.0.0');
  assert.notEqual(proof.pointer_file_url, proof.pricing_page_file_url);
  for (const [sample, hash] of [
    [proof.pointer_file_retained_sample, proof.pointer_file_sample_sha256],
    [proof.pricing_page_file_retained_sample, proof.pricing_page_file_sample_sha256],
  ]) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, sample))).digest('hex'), hash);
  assert.equal(resolution.evidence.url, proof.pointer_file_url);
  assert.equal(resolution.evidence.pageMrfUrl, proof.pricing_page_file_url);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '220111');
  assert.equal(row.finding, 'pricing-page-links-older-mrf-than-pointer');
  assert.equal(row.mrf_url, proof.pointer_file_url);
  assert.equal(view.history['220111'].finding, 'not-assessed-not-named-in-file');
  assert.equal(classifyRow(row, null).intervention, 'pricing-page-older-file');
  assert.equal(standingEvidenceRetained(row.finding, 'mrf-request-unsuccessful'), true);
});

test('older-page observation rejects an unproven date ordering', () => {
  assert.throws(() => applyResolutions([resolution.base], [], [], [{ ...resolution,
    evidence: { ...resolution.evidence, pageMrfDate: resolution.evidence.date } }]));
});
