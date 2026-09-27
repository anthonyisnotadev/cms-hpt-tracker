'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Jackson County keeps malformed pointer and distinct page file unresolved', () => {
  const proof = require(path.join(audit, 'reconciliation-jackson-county-pointer-proof.json'));
  const observation = require(path.join(audit, 'reconciliation-manual-access-observations.json'))
    .records.find(row => row.ccn === '161329');
  assert.equal(proof.roster_address, '700 W GROVE ST');
  assert.equal(proof.pointer_file_declared_address, '601 HOSPITAL DRIVE, MAQUOKETA, IA 52060');
  assert.equal(proof.pointer_misspelled_label, 'mfr-url');
  assert.equal(proof.pointer_has_mrf_url, false);
  assert.notEqual(proof.pointer_file_url, proof.pricing_page_file_url);
  assert.equal(proof.pointer_file_declared_date, '2025-07-29');
  assert.equal(proof.pointer_file_declared_version, '2.0.0');
  for (const [sample, sha] of [
    [proof.pointer_file_sample, proof.pointer_file_sample_sha256],
    [proof.pricing_page_file_sample, proof.pricing_page_file_sample_sha256],
  ]) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, sample))).digest('hex'), sha);
  }
  assert.ok(proof.pointer_file_retained_bytes < proof.pointer_file_total_bytes);
  assert.ok(proof.pricing_page_file_retained_bytes < proof.pricing_page_file_total_bytes);
  assert.equal(observation.disposition, 'verified-current-page-file-root-pointer-currentness-pending');
  assert.match(observation.next_action, /(?:reconcile|Update the root).*pointer.*(?:CSV|XLSX)/i);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '161329');
  assert.equal(row.finding, 'pointer-links-older-mrf-than-source-page');
  assert.equal(row.mrf_url, proof.pricing_page_file_url);
});
