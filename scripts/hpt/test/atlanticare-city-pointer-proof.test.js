'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../build-unresolved-investigation-worklist');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-atlanticare-city-pointer-proof.json'));

test('AtlantiCare City pointer label is not treated as Mainland file identity', () => {
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(sample.length, proof.file_sample_bytes);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.file_sample_sha256);
  assert.ok(proof.file_total_bytes > sample.length);
  assert.equal(proof.pointer_city_mrf_url, proof.pointer_mainland_mrf_url);
  assert.equal(proof.declared_location_name, 'ACRMC Mainland');
  assert.equal(proof.declared_address, '65 West Jimmie Leeds Road, Pomona NJ 08240');
  assert.notEqual(proof.declared_address, proof.campus_address);
  const reconciliation = require(path.join(audit, 'nationwide-reconciliation.json'));
  const verification = require(path.join(audit, 'nationwide-verification.json'));
  const worklist = build(reconciliation, verification);
  const row = worklist.records.find(item => item.ccn === proof.ccn);
  assert.equal(row.current_disposition, 'city-pointer-entry-targets-shared-file-with-mainland-only-bounded-header');
  assert.equal(row.evidence_gate, 'city-file-identity-and-scope');
  assert.equal(row.reviewed_follow_up, true);
  assert.equal(row.nationwide_disposition, 'pointer-facility-match-unresolved');
});
