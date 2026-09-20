'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-red-bay-wrong-site-proof.json'));

test('Red Bay quarantines unrelated Kaiser pointer without promoting unverified HH Health file', () => {
  const pointer = fs.readFileSync(path.join(root, proof.previous_pointer_artifact));
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.previous_pointer_sha256);
  assert.doesNotMatch(pointer.toString('utf8'), /Red Bay|211 Hospital Road|Alabama/i);
  const ledger = require(path.join(audit, 'reviewed-resolutions.json'));
  const resolution = ledger.find(row => row.ccn === proof.ccn);
  assert.equal(resolution.action, 'quarantine');
  assert.equal(resolution.official.domain, 'hh.health');
  assert.equal(resolution.evidence.first_party_page_file_url,
    'https://hh.health/wp-content/uploads/472323163_red-bay-hospital_standardcharges.csv');
  assert.equal(resolution.evidence.page_file_byte_status, 'not retrieved in this client; DNS resolution failed');
  const view = loadReviewedView(audit);
  const standing = view.compliance.find(row => row.ccn === proof.ccn);
  assert.equal(standing.domain, 'hh.health');
  assert.equal(standing.mrf_url, '');
  assert.match(standing.finding, /not-assessed|identity/);
  assert.equal(view.history[proof.ccn].domain, 'healthy.kaiserpermanente.org');
});
