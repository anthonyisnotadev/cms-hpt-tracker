'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('SSHA preserves its 404 pointer target and the distinct reviewed page file', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-ssha-page-file-proof.json'), 'utf8'));
  const resolution = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'))
    .find(row => row.ccn === '450831');
  const standing = loadReviewedView(audit).compliance.find(row => row.ccn === '450831');
  const bytes = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(proof.pointer_mrf_http_status, 404);
  assert.notEqual(proof.pointer_mrf_url, proof.current_mrf_url);
  assert.equal(bytes.length, proof.file_total_bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), proof.current_mrf_sha256);
  assert.equal(proof.declared_location_name, 'Surgery Specialty Hospitals of America');
  assert.equal(proof.declared_address, '4301 Vista Road, Pasadena, TX 77504');
  assert.equal(proof.cms_roster_address, '4301 B VISTA');
  assert.equal(resolution.action, 'replace-observation');
  assert.equal(resolution.evidence.pointerMrfUrl, proof.pointer_mrf_url);
  assert.equal(resolution.evidence.url, proof.current_mrf_url);
  assert.equal(standing.finding, 'pointer-links-unavailable-mrf-source-page-current-file');
  assert.equal(standing.mrf_url, proof.current_mrf_url);
  assert.notEqual(standing.finding, 'compliant-observed');
});
