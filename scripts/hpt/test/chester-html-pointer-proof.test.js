'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Chester preserves HTML root and indirect portal despite matching CSV and JSON', () => {
  const proof = require(path.join(audit, 'reconciliation-chester-html-pointer-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === '141338');
  assert.equal(proof.roster_address, '1900 STATE ST');
  assert.match(proof.pointer_content_type, /^text\/html/);
  assert.equal(proof.pointer_final_url, 'https://www.mhchester.com/cms-hpt-txt');
  assert.equal(proof.pointer_html_visible_mrf_url, proof.source_page_url);
  assert.notEqual(proof.csv_url, proof.pointer_html_visible_mrf_url);
  assert.equal(proof.declared_address, '1900 State St, , Chester, IL 62233');
  assert.equal(proof.declared_license_state, 'IL');
  assert.equal(proof.declared_date, '2026-06-04');
  assert.equal(proof.declared_version, '3.0.0');
  for (const [sample, sha] of [
    [proof.csv_retained_sample, proof.csv_sample_sha256],
    [proof.json_retained_sample, proof.json_sample_sha256],
  ]) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, sample))).digest('hex'), sha);
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.observedFinding, 'root-pointer-html-page-with-official-page-file');
  const view = loadReviewedView(audit);
  assert.equal(view.compliance.find(row => row.ccn === '141338').finding, resolution.evidence.observedFinding);
  assert.equal(view.history['141338'].finding, 'not-assessed-domain-unknown');
});
