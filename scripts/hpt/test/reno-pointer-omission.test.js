'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView, applyResolutions } = require('../lib/reviewed-resolutions');
const { classifyRow, evidenceUrlFor } = require('../build-interventions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-reno-pointer-omission-proof.json'));

test('Reno complete page CSV stays distinct from root pointer that omits Reno', () => {
  const file = fs.readFileSync(path.join(root, proof.retained_file));
  assert.equal(file.length, proof.page_mrf_total_bytes);
  assert.equal(crypto.createHash('sha256').update(file).digest('hex'), proof.page_mrf_sha256);
  assert.equal(proof.pointer_lists_reno, false);
  assert.equal(proof.pointer_lists_page_file, false);
  assert.equal(proof.pointer_location_names.length, 10);
  assert.equal(proof.pointer_location_names.some(name => /Reno/i.test(name)), false);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '294015');
  assert.equal(row.finding, 'root-pointer-omits-facility-page-file-found');
  assert.equal(row.domain, 'renobehavioral.com');
  assert.equal(row.pointer_url, proof.pointer_url);
  assert.equal(row.mrf_url, proof.page_mrf_url);
  assert.equal(view.history['294015'].finding, 'not-assessed-not-named-in-file');
  assert.equal(classifyRow(row, null).intervention, 'root-pointer-omits-facility');
  assert.equal(evidenceUrlFor(row), proof.pointer_url);
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(item => item.ccn === '294015');
  assert.throws(() => applyResolutions([resolution.base], [], [], [{ ...resolution,
    evidence: { ...resolution.evidence, pointerListsFacility: true } }]), /lacks current/);
  assert.throws(() => applyResolutions([resolution.base], [], [], [{ ...resolution,
    evidence: { ...resolution.evidence, fileTotalBytes: resolution.evidence.fileBytes + 1 } }]), /lacks current/);
});
