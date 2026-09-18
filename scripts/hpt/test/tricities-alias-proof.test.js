'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');
const { protectPublicUrls } = require('../lib/public-url-safety');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('TriCities former-name match remains campus-specific and signed URL is withheld publicly', () => {
  const proof = require(path.join(audit, 'reconciliation-tricities-alias-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json')).find(row => row.ccn === '490020');
  assert.equal(proof.roster_name, 'JOHN RANDOLPH MEDICAL CENTER');
  assert.deepEqual(proof.pointer_location_names, ['TRICITIES HOSPITAL', 'PRINCE GEORGE ER']);
  assert.match(proof.declared_addresses, /411 W RANDOLPH RD, HOPEWELL, VA, 23860/);
  assert.match(proof.declared_addresses, /1700 TEMPLE PKWY, PRINCE GEORGE, VA, 23875/);
  assert.equal(proof.declared_date, '2026-03-01');
  assert.equal(proof.declared_version, '3.0.0');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(crypto.createHash('sha256').update(resolution.evidence.url).digest('hex'), proof.signed_file_url_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  assert.equal(protectPublicUrls(resolution.evidence.url), '');
  assert.equal(protectPublicUrls(resolution.note).includes('sig='), false);
  const view = loadReviewedView(audit);
  assert.equal(view.compliance.find(row => row.ccn === '490020').mrf_url, resolution.evidence.url);
  assert.equal(view.history['490020'].finding, 'not-assessed-not-named-in-file');
});
