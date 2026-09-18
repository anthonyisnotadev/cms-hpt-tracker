'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-bristol-page-file-proof.json'));

test('Bristol working page file does not erase the broken pointer target', () => {
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sample.length, 262144);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.current_mrf_sha256);
  assert.notEqual(proof.pointer_mrf_url, proof.current_mrf_url);
  assert.equal(proof.pointer_mrf_http_status, 404);
  assert.equal(proof.current_mrf_http_status, 206);
  assert.equal(proof.rendered_source_download_url, proof.current_mrf_url);
  assert.match(sample.toString('utf8', 0, 2000), /Bristol Hospital, Inc.*,2026-08-27,3\.0\.0,Bristol Hospital/);
  assert.match(sample.toString('utf8', 0, 2000), /41 Brewster Rd, Bristol, CT 06010/);
  const ledger = require(path.join(audit, 'reviewed-resolutions.json'));
  const resolution = ledger.find(row => row.ccn === '070029');
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.observedFinding, 'pointer-links-unavailable-mrf-source-page-current-file');
  const view = loadReviewedView(audit);
  const standing = view.compliance.find(row => row.ccn === '070029');
  assert.equal(standing.finding, resolution.evidence.observedFinding);
  assert.equal(standing.mrf_url, proof.current_mrf_url);
  assert.equal(view.history['070029'].finding, 'not-assessed-domain-unknown');
});
