'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../../..');
const proof = require(path.join(root, 'data/hpt-audit/reconciliation-reviewed-alias-pointer-proof.json')).records;
const ledger = require(path.join(root, 'data/hpt-audit/reviewed-resolutions.json'));

test('CHOC Mission has its own pointer entry, campus corroboration, and retained file header', () => {
  const row = proof.find(item => item.ccn === '053306');
  const resolution = ledger.find(item => item.ccn === '053306');
  assert.ok(row);
  assert.equal(row.pointer_location_name, 'CHOC at Mission Hospital');
  assert.equal(row.roster_address, '27700 MEDICAL CENTER RD, 5TH FLOOR');
  assert.equal(row.declared_hospital_name, 'Childrens Hospital at Mission - Cerner');
  assert.equal(row.declared_address, '27700 Medical Center Rd');
  assert.equal(row.declared_license_state, 'CA');
  assert.equal(row.version, '3.0.0');
  assert.equal(row.finding, 'compliant-observed');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, row.retained_sample))).digest('hex'), row.retained_sha256);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, row.pointer_file))).digest('hex'), row.pointer_sha256);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.url, row.mrf_url);
  assert.equal(resolution.evidence.identityPageSha256, row.identity_sha256);
});
