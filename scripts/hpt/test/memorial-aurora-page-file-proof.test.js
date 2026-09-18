'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-memorial-aurora-page-file-proof.json'));
const ledger = require(path.join(audit, 'reviewed-resolutions.json'));

test('Aurora Memorial page CSV stays distinct from the broken pointer target and wrong UPMC history', () => {
  const wrongPointer = fs.readFileSync(path.join(root, proof.wrong_pointer_artifact));
  assert.equal(crypto.createHash('sha256').update(wrongPointer).digest('hex'), proof.wrong_pointer_sha256);
  assert.doesNotMatch(wrongPointer.toString('utf8'), /Aurora|Nebraska|Memorial Hospital/i);
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sample.length, 262144);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.current_mrf_sha256);
  assert.equal(proof.pointer_mrf_http_status, 404);
  assert.equal(proof.current_mrf_http_status, 206);
  assert.notEqual(proof.pointer_mrf_url, proof.current_mrf_url);
  assert.equal(proof.rendered_source_download_url, proof.current_mrf_url);
  assert.equal(proof.declared_address, '1423 7th St, Aurora, NE 68818');
  assert.equal(proof.declared_state, 'NE');
  const resolution = ledger.find(row => row.ccn === '281320');
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.observedFinding, 'pointer-links-unavailable-mrf-source-page-current-file');
  const view = loadReviewedView(audit);
  const standing = view.compliance.find(row => row.ccn === '281320');
  assert.equal(standing.domain, 'memorialcommunityhealth.org');
  assert.equal(standing.finding, resolution.evidence.observedFinding);
  assert.equal(standing.pointer_url, proof.pointer_url);
  assert.equal(standing.mrf_url, proof.current_mrf_url);
  assert.equal(view.history['281320'].domain, 'upmc.com');
});
