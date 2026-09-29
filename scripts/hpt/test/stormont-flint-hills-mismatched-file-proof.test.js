'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-stormont-flint-hills-mismatched-file-proof.json'));

test('Flint Hills pointer-labeled CSV cannot be attributed to Junction City while declaring Topeka', () => {
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const pointer = fs.readFileSync(path.join(root, proof.pointer_retained_raw));
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sha(pointer), proof.pointer_sha256);
  assert.equal(sha(sample), proof.file_sample_sha256);
  assert.match(pointer.toString('utf8'), /location-name:Stormont Vail Flint Hills LLC/);
  assert.match(sample.toString('utf8', 0, 1500), /1500 SW 10th Ave, Topeka, KS 66604/);
  assert.doesNotMatch(sample.toString('utf8', 0, 1500), /1102 St\. Marys Road/);
  const ledger = require(path.join(audit, 'reviewed-resolutions.json'));
  const resolution = ledger.find(row => row.ccn === proof.ccn);
  assert.equal(resolution.action, 'quarantine');
  assert.equal(resolution.proof.payload_sha256, proof.file_sample_sha256);
  const view = loadReviewedView(audit);
  const standing = view.compliance.find(row => row.ccn === proof.ccn);
  assert.equal(standing.finding, 'not-assessed-identity-conflict');
  assert.equal(standing.mrf_url, '');
  assert.equal(view.history[proof.ccn].finding, 'not-assessed-domain-unknown');
});
