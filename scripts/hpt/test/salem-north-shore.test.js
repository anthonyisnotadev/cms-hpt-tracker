'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-salem-north-shore-proof.json')));

test('Salem uses the Mass General Brigham pointer and its own file, not Miami North Shore', () => {
  const pointer = fs.readFileSync(path.join(root, proof.correct_publisher.pointer_cached_file));
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.correct_publisher.pointer_sha256);
  assert.match(pointer.toString('utf8'), /location-name: Salem Hospital\r?\nsource-page-url: [^\r\n]+\r?\nmrf-url: https:\/\/www\.massgeneralbrigham\.org\/price-transparency\/043399616_Salem-Hospital_StandardCharges\.zip/);
  assert.equal(proof.rejected_prior_domain.separate_roster_ccn, '100029');
  assert.equal(proof.file.hospital_address, '81 Highland Ave Salem MA 01970');
  assert.equal(proof.file.license_state_field, 'MA');
  const resolution = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json')))
    .find(row => row.ccn === proof.ccn);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.fileSha256, proof.file.zip_sha256);
  assert.equal(resolution.evidence.memberSha256, proof.file.member_sha256);
  assert.equal(resolution.evidence.url, proof.correct_publisher.pointer_mrf_url);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === proof.ccn);
  assert.equal(row.domain, proof.correct_publisher.domain);
  assert.match(row.pointer_url, /^https:\/\/(?:www\.)?massgeneralbrigham\.org\/cms-hpt\.txt$/);
  assert.equal(row.mrf_url, proof.correct_publisher.pointer_mrf_url);
  assert.equal(row.mrf_last_updated, proof.file.last_updated_on);
  assert.equal(row.cms_template_version, proof.file.version);
  assert.equal(view.applied.includes(proof.ccn), true);
});
