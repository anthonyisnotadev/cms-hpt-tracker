'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Yale New Haven page file remains distinct from its 404 pointer target and roster ZIP exception', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-yale-new-haven-pointer-mismatch-proof.json'), 'utf8'));
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const address = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-address-equivalences.json'), 'utf8'))
    .records.find(row => row.ccn === '070022');
  const resolution = ledger.find(row => row.ccn === '070022');
  const standing = loadReviewedView(audit).compliance.find(row => row.ccn === '070022');
  assert.equal(sample.length, 262144);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.current_mrf_sha256);
  assert.equal(proof.pointer_mrf_http_status, 404);
  assert.notEqual(proof.pointer_mrf_url, proof.current_mrf_url);
  assert.equal(proof.declared_hospital_name, 'Yale New Haven Hospital');
  assert.match(proof.declared_address, /20 York St, New Haven CT, 06510/);
  assert.equal(proof.declared_state, 'CT');
  assert.equal(address.roster_address, '20 YORK ST, NEW HAVEN CT 06504');
  assert.equal(address.file_address, '20 York St, New Haven CT, 06510');
  assert.equal(resolution.evidence.observedFinding, 'pointer-links-unavailable-mrf-source-page-current-file');
  assert.equal(resolution.evidence.pointerMrfUrl, proof.pointer_mrf_url);
  assert.equal(resolution.evidence.url, proof.current_mrf_url);
  assert.equal(standing.finding, resolution.evidence.observedFinding);
  assert.equal(standing.mrf_url, proof.current_mrf_url);
});
