'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-princeton-pointer-proof.json'));

test('Princeton recovery retains pointer-linked multi-location header as bounded evidence', () => {
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sample.length, 65536);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.mrf_sha256);
  assert.ok(proof.total_bytes > sample.length);
  assert.equal(proof.pointer_location_name, 'Penn Medicine Princeton Health');
  assert.equal(proof.pointer_mrf_url.includes('210635009_penn-medicine-princeton-medical-center'), true);
  assert.ok(proof.declared_location_names.includes('Princeton Rehabilitation'));
  assert.ok(proof.declared_location_names.includes('Princeton House Behavioral Health'));
  assert.ok(proof.declared_addresses.includes('1 Plainsboro Rd., Plainsboro, NJ 08536'));
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '310010');
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(row.domain, 'pennmedicine.org');
  assert.equal(row.pointer_url, proof.pointer_url);
  assert.equal(row.mrf_url, proof.pointer_mrf_url);
  assert.equal(view.history['310010'].finding, 'not-assessed-domain-unknown');
});
