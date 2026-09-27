'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Siouxland acquisition evidence does not assign parent CCN or incorrect-address file to 160153', () => {
  const proof = require(path.join(audit, 'reconciliation-siouxland-transition-proof.json'));
  const observation = require(path.join(audit, 'reconciliation-manual-access-observations.json'))
    .records.find(row => row.ccn === '160153');
  assert.equal(proof.roster_address, '801 5TH ST');
  assert.equal(proof.state_directory_current_ccn, '160146');
  assert.equal(proof.state_directory_former_name, 'MERCYONE SIOUXLAND MEDICAL CENTER');
  assert.match(proof.declared_addresses, /801 15th St, Sioux City, IA 51101/);
  assert.match(proof.state_directory_address, /801 5th ST/);
  assert.equal(proof.declared_date, '2026-01-28');
  assert.equal(proof.declared_version, '3.0.0');
  assert.ok(proof.retained_bytes < proof.file_total_bytes);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(observation.disposition, 'current-cms-identity-recheck-transition-unresolved');
  assert.match(observation.next_action, /160153 unresolved|effective-dated CMS enrollment|publisher clarification/i);
  const view = loadReviewedView(audit);
  assert.notEqual(view.compliance.find(row => row.ccn === '160153').mrf_url, proof.shared_file_url);
  assert.equal(view.compliance.find(row => row.ccn === '160146').mrf_url, proof.shared_file_url);
});
