'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Schuylkill South Jackson former name resolves only to its exact campus in shared file', () => {
  const proof = require(path.join(audit, 'reconciliation-schuylkill-alias-proof.json'));
  const resolution = require(path.join(audit, 'reviewed-resolutions.json')).find(row => row.ccn === '390030');
  assert.equal(proof.roster_name, 'SCHUYLKILL MEDICAL CENTER - SOUTH JACKSON STREET');
  assert.match(proof.declared_location_names, /Schuylkill S\. Jackson Street/);
  assert.match(proof.declared_addresses, /420 S Jackson St, Pottsville, PA 17901-3625/);
  assert.match(proof.declared_addresses, /700 E Norwegian St, Pottsville, PA 17901-27100/);
  assert.equal(proof.declared_date, '2026-07-01');
  assert.equal(proof.declared_version, '3.0.0');
  assert.equal(proof.page_file_sample_sha256, proof.sample_sha256);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.pointerSha256, proof.pointer_sha256);
  assert.equal(resolution.evidence.fileSha256, proof.sample_sha256);
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '390030');
  assert.equal(row.mrf_url, proof.pointer_file_url);
  assert.equal(view.history['390030'].finding, 'not-assessed-not-named-in-file');
});
