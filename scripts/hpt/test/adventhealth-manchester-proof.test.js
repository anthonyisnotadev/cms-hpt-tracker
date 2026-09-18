'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-adventhealth-manchester-proof.json'));
const resolution = require(path.join(audit, 'reviewed-resolutions.json')).find(row => row.ccn === '180043');

test('joined roster name is reconciled to exact Manchester pointer and JSON without hiding portal error', () => {
  assert.equal(proof.roster_name, 'AdventHealthManchester');
  assert.equal(proof.pointer_location_name, 'Adventhealth Manchester');
  assert.equal(proof.declared_address, '210 Marie Langdon Drive, Manchester, KY 40962');
  assert.equal(proof.declared_license_state, 'KY');
  assert.equal(proof.declared_date, '2026-04-01');
  assert.equal(proof.declared_version, '3.0.0');
  assert.equal(proof.pointer_entry_without_contacts.length, 3);
  assert.equal(proof.portal_client_final_url, 'https://hospitalpricedisclosure.com/error/default.htm');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '180043');
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.mrf_url, proof.file_url);
  assert.equal(view.history['180043'].finding, 'not-assessed-not-named-in-file');
});
