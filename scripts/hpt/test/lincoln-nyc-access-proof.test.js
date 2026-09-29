'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Lincoln browser download resolves the page-access gate with complete identity evidence', () => {
  const proof = require(path.join(audit, 'reconciliation-lincoln-nyc-access-proof.json'));
  const observation = require(path.join(audit, 'reconciliation-manual-access-observations.json')).records
    .find(row => row.ccn === '330080');
  assert.equal(proof.roster_name, 'LINCOLN MEDICAL & MENTAL HEALTH CENTER');
  assert.equal(proof.declared_location_name, 'Lincoln Medical Center');
  assert.equal(proof.declared_address, '234 E 149th St, Bronx, NY 10451');
  assert.equal(proof.declared_license_state, 'NY');
  assert.equal(proof.declared_date, '2026-09-05');
  assert.equal(proof.declared_version, '3.0.0');
  assert.equal(proof.identity_bounded_client_response, 'Radware Captcha Page');
  assert.equal(proof.pricing_bounded_client_response, 'Radware Captcha Page');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(observation.pointer_file_sample_sha256, proof.sample_sha256);
  assert.equal(proof.web_reader_recheck.linked_file_name, '132655001_Lincoln-Medical-Center_standardcharges.csv');
  assert.equal(observation.latest_web_reader_recheck.linked_file_url, proof.file_url);
  const complete = require(path.join(audit, 'reconciliation-lincoln-browser-download-complete-proof-2026-09-20.json'));
  assert.equal(complete.full_file_bytes, 686193592);
  assert.equal(complete.full_file_sha256, '6a3529cc8b927eb186526f159785f111dcc68b7a17da4b7a112e9842c27cb173');
  assert.equal(complete.header.location_name, 'Lincoln Medical Center');
  assert.equal(complete.header.declared_license_state, 'NY');
  assert.equal(complete.header.version, '3.0.0');
  const view = loadReviewedView(audit);
  assert.equal(view.compliance.find(row => row.ccn === '330080').finding,
    'compliant-observed');
  assert.equal(view.history['330080'].finding, 'not-assessed-not-named-in-file');
});
