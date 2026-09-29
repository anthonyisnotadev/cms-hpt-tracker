'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-hudson-license-state-proof.json')));

test('Hudson exact pointer and Wisconsin identity retain the Minnesota license-state conflict', () => {
  const pointer = fs.readFileSync(path.join(root, proof.current_pointer.cached_file));
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.current_pointer.sha256);
  assert.match(pointer.toString('utf8'), /location-name: Hudson Hospital\r?\nsource-page-url: [^\r\n]+\r?\nmrf-url: https:\/\/www\.healthpartners\.com\/content\/dam\/brand-identity\/pdfs\/care\/390804125_hudsonhospital_standardcharges\.csv/);
  assert.equal(proof.pointer_linked_file.declared_address, proof.first_party_identity.observed_address);
  assert.equal(proof.pointer_linked_file.declared_license_state_field, 'MN');
  assert.equal(proof.roster.state, 'WI');
  const resolution = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json')))
    .find(row => row.ccn === proof.ccn);
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.fileSha256, proof.pointer_linked_file.sample_sha256);
  assert.equal(resolution.evidence.observedFinding, 'mrf-license-state-field-conflicts-facility');
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === proof.ccn);
  assert.equal(row.finding, 'mrf-license-state-field-conflicts-facility');
  assert.equal(row.pointer_url, proof.current_pointer.url);
  assert.equal(row.mrf_url, proof.current_pointer.mrf_url);
  assert.notEqual(row.finding, 'compliant-observed');
});
