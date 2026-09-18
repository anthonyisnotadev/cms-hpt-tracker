'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Lincoln retains unresolved page-access gate despite pointer and file header', () => {
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
  const view = loadReviewedView(audit);
  assert.equal(view.compliance.find(row => row.ccn === '330080').finding,
    'not-assessed-nationwide-pointer-facility-match-unresolved');
});
