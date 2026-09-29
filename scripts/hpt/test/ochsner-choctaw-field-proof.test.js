'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-ochsner-choctaw-field-proof.json'));

test('Choctaw uses its own exact pointer file and preserves Alabama/LA header conflict', () => {
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const pointer = fs.readFileSync(path.join(root, proof.pointer_retained_raw));
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(hash(pointer), proof.pointer_sha256);
  assert.match(pointer.toString('utf8'), /location-name: Ochsner Choctaw General Hospital/);
  assert.match(pointer.toString('utf8'), /640655993_rush-hospitalbutler-inc/);
  assert.equal(sample.length, 262144);
  assert.equal(hash(sample), proof.mrf_sample_sha256);
  assert.match(sample.toString('utf8', 0, 2200), /license_number\|LA/);
  assert.match(sample.toString('utf8', 0, 2200), /Ochsner Choctaw General Hospital,"401 Vanity Fair Lane , Butler, AL 36904",H1201\|AL/);
  const ledger = require(path.join(audit, 'reviewed-resolutions.json'));
  const resolution = ledger.find(row => row.ccn === proof.ccn);
  assert.equal(resolution.evidence.observedFinding, 'mrf-license-state-field-conflicts-facility');
  assert.equal(resolution.evidence.facility_state, 'AL');
  assert.equal(resolution.evidence.declared_license_state, 'LA');
  assert.match(resolution.evidence.addressCaveat, /Ave.*Lane/);
  const view = loadReviewedView(audit);
  const standing = view.compliance.find(row => row.ccn === proof.ccn);
  assert.equal(standing.finding, resolution.evidence.observedFinding);
  assert.equal(standing.mrf_url, proof.mrf_url);
  assert.equal(view.history[proof.ccn].finding, 'not-assessed-not-named-in-file');
});
