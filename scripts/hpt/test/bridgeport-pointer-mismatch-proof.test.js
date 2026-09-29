'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Bridgeport retained page CSV is not misrepresented as the working pointer target', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-bridgeport-pointer-mismatch-proof.json'), 'utf8'));
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const resolution = ledger.find(row => row.ccn === '070010');
  const view = loadReviewedView(audit);
  const standing = view.compliance.find(row => row.ccn === '070010');
  assert.equal(sample.length, 262144);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.current_mrf_sha256);
  assert.equal(proof.pointer_mrf_http_status, 404);
  assert.notEqual(proof.pointer_mrf_url, proof.current_mrf_url);
  assert.equal(proof.declared_hospital_name, 'Bridgeport Hospital');
  assert.match(proof.declared_address, /267 Grant Street, Bridgeport CT, 06610/);
  assert.equal(proof.declared_state, 'CT');
  assert.equal(resolution.evidence.observedFinding, 'pointer-links-unavailable-mrf-source-page-current-file');
  assert.equal(resolution.evidence.pointerMrfUrl, proof.pointer_mrf_url);
  assert.equal(resolution.evidence.url, proof.current_mrf_url);
  assert.equal(standing.finding, resolution.evidence.observedFinding);
  assert.equal(standing.mrf_url, proof.current_mrf_url);
  assert.equal(standing.assessable, 'yes');
});
