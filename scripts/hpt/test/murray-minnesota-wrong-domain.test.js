'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-murray-minnesota-wrong-domain-proof.json')));

test('Murray Minnesota rejects only the separately identified Oklahoma file', () => {
  const bytes = fs.readFileSync(path.join(root, proof.rejected_assignment.pointer_cached_file));
  assert.equal(bytes.length, proof.rejected_assignment.pointer_bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), proof.rejected_assignment.pointer_sha256);
  assert.match(bytes.toString('utf8'), /^location-name: Pushmataha Hospital/m);
  assert.equal(proof.rejected_assignment.declared_license_state, 'OK');
  assert.equal(proof.correct_site.pricing_page_file_declared_license_state, 'MN');
  assert.equal(proof.correct_site.pricing_page_file_declared_address, proof.roster.address);
  assert.notEqual(proof.correct_site.pricing_page_file_url, proof.correct_site.historical_web_pointer_file_url);
  const resolution = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json')))
    .find(row => row.ccn === proof.ccn);
  assert.equal(resolution.action, 'quarantine');
  assert.equal(resolution.official.domain, proof.correct_site.domain);
  assert.equal(resolution.proof.pointer_sha256, proof.rejected_assignment.pointer_sha256);
  assert.equal(resolution.proof.payload_sha256, proof.rejected_assignment.pointer_file_sha256);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === proof.ccn);
  assert.equal(row.finding, 'not-assessed-identity-conflict');
  assert.equal(row.domain, proof.correct_site.domain);
  assert.equal(row.pointer_url, '');
  assert.equal(row.mrf_url, '');
  assert.equal(view.applied.includes(proof.ccn), true);
});
