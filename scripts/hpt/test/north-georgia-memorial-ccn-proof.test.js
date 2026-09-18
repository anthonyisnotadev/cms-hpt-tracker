'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-north-georgia-memorial-ccn-proof.json'));

test('North Georgia Memorial exact CCN retains its own pointer and JSON metadata', () => {
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const pointer = fs.readFileSync(path.join(root, proof.pointer_retained_raw));
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sha(pointer), proof.pointer_sha256);
  assert.match(pointer.toString('utf8'), /location-name:\s*CHI Memorial Hospital - Georgia/);
  assert.match(pointer.toString('utf8'), /822748395-1356860621_chi-memorial-hospital-georgia_standardcharges\.json/);
  assert.equal(sample.length, 262144);
  assert.equal(sha(sample), proof.mrf_sample_sha256);
  assert.match(sample.toString('utf8', 0, 600), /CHI MEMORIAL HOSPITAL - GEORGIA.*2026-02-28.*CHI Memorial Hospital - Georgia/);
  assert.match(sample.toString('utf8', 0, 600), /4710 Battlefield Pkwy, Ringgold, GA 30736/);
  assert.match(sample.toString('utf8', 0, 600), /"state":"GA"/);
  const ledger = require(path.join(audit, 'reviewed-resolutions.json'));
  const resolution = ledger.find(row => row.ccn === proof.ccn);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.cmsExactCcnUrl, proof.cms_exact_ccn_url);
  assert.equal(resolution.evidence.observedFinding, 'compliant-observed');
  const view = loadReviewedView(audit);
  const standing = view.compliance.find(row => row.ccn === proof.ccn);
  assert.equal(standing.mrf_url, proof.mrf_url);
  assert.equal(standing.finding, 'compliant-observed');
  assert.equal(view.history[proof.ccn].finding, 'not-assessed-not-named-in-file');
});
