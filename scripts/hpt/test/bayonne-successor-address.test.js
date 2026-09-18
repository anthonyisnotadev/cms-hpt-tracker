'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView, applyResolutions } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-bayonne-successor-address-proof.json'));

test('Bayonne successor file retains literal intersection address and separate page URL', () => {
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sample.length, proof.file_sample_bytes);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.file_sample_sha256);
  assert.ok(proof.file_total_bytes > sample.length);
  assert.equal(proof.legacy_pointer_sha256, proof.pointer_sha256);
  assert.notEqual(proof.pointer_mrf_url, proof.pricing_page_file_url);
  assert.equal(proof.page_file_sample_sha256, proof.file_sample_sha256);
  assert.equal(proof.declared_address, '29th Street & Avenue E, Bayonne, NJ 07002');
  assert.equal(proof.identity_page_address, '29 E 29th Street, Bayonne, NJ 07002');
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === proof.ccn);
  assert.equal(row.finding, 'mrf-address-field-incomplete');
  assert.equal(row.domain, 'hudsonregionalhospital.com');
  assert.equal(row.pointer_url, proof.pointer_url);
  assert.equal(row.mrf_url, proof.pointer_mrf_url);
  assert.equal(view.history[proof.ccn].finding, 'not-assessed-not-named-in-file');
  const resolution = require(path.join(audit, 'reviewed-resolutions.json'))
    .find(item => item.ccn === proof.ccn);
  assert.throws(() => applyResolutions([resolution.base], [], [], [{ ...resolution,
    evidence: { ...resolution.evidence, missing_address_component: 'Avenue E' } }]), /lacks current/);
});
