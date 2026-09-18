'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Hansen is linked to the Ellsworth legal-name CSV at the exact Iowa Falls campus', () => {
  const proof = require(path.join(audit, 'reconciliation-hansen-ellsworth-alias-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(row => row.ccn === '161380');
  assert.equal(proof.roster_name, 'HANSEN FAMILY HOSPITAL');
  assert.equal(proof.roster_address, '920 SOUTH OAK STREET');
  assert.equal(proof.declared_hospital_name, 'ELLSWORTH MUNICIPAL HOSPITAL');
  assert.equal(proof.declared_address, '920 S Oak St Iowa Falls IA 50126');
  assert.equal(proof.declared_license_state, 'IA');
  assert.equal(proof.declared_date, '2026-07-10');
  assert.equal(proof.declared_version, '3.0.0');
  assert.notEqual(proof.pointer_file_url, proof.pricing_page_generated_file_url);
  assert.equal(proof.page_and_pointer_sample_match, true);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.stateIdentitySha256, proof.state_dba_bridge_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  assert.equal(view.compliance.find(row => row.ccn === '161380').finding, 'compliant-observed');
  assert.equal(view.history['161380'].finding, 'not-assessed-not-named-in-file');
});
