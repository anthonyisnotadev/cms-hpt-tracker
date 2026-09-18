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
const proof = require(path.join(auditDir, 'reconciliation-estes-valley-proof.json')).record;

test('Estes Valley UCHealth pointer and page supersede vendor-domain no-pointer result', () => {
  const original = csvToObjects(fs.readFileSync(path.join(auditDir, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '061312');
  assert.equal(original.domain, 'search.hospitalpriceindex.com');
  assert.equal(original.finding, 'no-cms-hpt-txt-published');
  assert.equal(proof.ccn, '061312');
  assert.equal(proof.pointer_http_status, 200);
  assert.equal(proof.official_pricing_page_http_status, 200);
  assert.equal(proof.official_identity_http_status, 200);
  assert.equal(proof.mrf_http_status, 206);
  assert.equal(proof.declared_hospital_name, 'UCHealth Estes Valley Medical Center');
  assert.equal(proof.declared_address.split('|')[0], '555 Prospect Avenue, Estes Park, CO 80517');
  assert.equal(proof.declared_state, 'CO');
  assert.equal(proof.declared_date, '2025-11-01');
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
