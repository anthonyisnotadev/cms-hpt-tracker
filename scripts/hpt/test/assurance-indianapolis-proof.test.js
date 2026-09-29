'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Assurance Indianapolis CCN is tied to its distinct campus in the shared CSV', () => {
  const proof = require(path.join(audit, 'reconciliation-assurance-indianapolis-proof.json'));
  const resolutions = require(path.join(audit, 'reviewed-resolutions.json'));
  const resolution = resolutions.find(row => row.ccn === '154064');
  assert.equal(proof.roster_name, 'ASSURANCE HEALTH PSYCHIATRIC HOSPITAL');
  assert.equal(proof.license_number_field, 'license_number|IN');
  assert.equal(proof.license_number_value, '154064');
  assert.match(proof.declared_addresses, /900 N High School Road, Indianapolis, IN 46214/);
  assert.match(proof.declared_addresses, /2725 Enterprise Drive, Anderson, IN 46013/);
  assert.equal(proof.declared_date, '2026-04-01');
  assert.equal(proof.declared_version, '3.0.0');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '154064');
  assert.equal(row.mrf_url, proof.file_url);
  assert.equal(view.history['154064'].finding, 'not-assessed-domain-unknown');
});
