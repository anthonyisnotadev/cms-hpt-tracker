'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');
const { csvToObjects } = require('../lib/util');

const root = path.resolve(__dirname, '../../..');
const auditDir = path.join(root, 'data/hpt-audit');
const proof = require(path.join(auditDir, 'reconciliation-arkansas-surgical-proof.json')).record;

test('Arkansas Surgical hospital-owned pointer supersedes vendor-domain no-pointer result', () => {
  const original = csvToObjects(fs.readFileSync(path.join(auditDir, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '040147');
  assert.equal(original.domain, 'clariti-health.com');
  assert.equal(original.finding, 'no-cms-hpt-txt-published');
  assert.equal(proof.ccn, '040147');
  assert.equal(proof.pointer_http_status, 200);
  assert.equal(proof.pointer_final_url, 'https://arksurgicalhospital.com/wp-content/uploads/2026/01/cms-hpt-1.txt');
  assert.equal(proof.mrf_http_status, 200);
  assert.equal(proof.declared_hospital_name, 'Arkansas Surgical Hospital, LLC');
  assert.equal(proof.declared_address, '5201 Northshore Drive,,North Little Rock,AR,72118');
  assert.equal(proof.declared_state, 'AR');
  assert.equal(proof.declared_date, '2026-03-13');
  assert.equal(proof.version, '3.0.0');
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sample.length, proof.retained_bytes);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.mrf_sample_sha256);
  const standing = loadReviewedView(auditDir).compliance.find(row => row.ccn === proof.ccn);
  assert.equal(standing.finding, 'compliant-observed');
  assert.equal(standing.domain, proof.official_domain);
  assert.equal(standing.pointer_url, proof.pointer_url);
  assert.equal(standing.mrf_url, proof.mrf_url);
});
