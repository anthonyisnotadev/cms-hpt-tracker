'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Bowling Green records pointer-linked ZIP identity while retaining full-file uncertainty', () => {
  const proof = require(path.join(audit, 'reconciliation-bowling-green-pointer-access-proof.json'));
  const observation = require(path.join(audit, 'reconciliation-manual-access-observations.json'))
    .records.find(row => row.ccn === '180013');
  assert.equal(proof.roster_address, '250 PARK STREET');
  assert.equal(proof.pointer_target_url, 'https://medcenterhealth.org/charges/mcbg/');
  assert.equal(proof.pointer_target_bounded_http_status, 403);
  assert.equal(proof.current_pointer_target_http_status, 200);
  assert.equal(proof.current_pointer_archive_bytes, 25516242);
  assert.equal(proof.current_pointer_member_prefix_bytes, 131072);
  assert.notEqual(proof.pointer_target_url, proof.hosted_file_url);
  assert.equal(proof.declared_location_name, 'The Medical Center at Bowling Green');
  assert.equal(proof.declared_address, '250 Park St. Bowling Green, KY 42101');
  assert.equal(proof.declared_license_state, 'KY');
  assert.equal(proof.declared_date, '2026-04-01');
  assert.equal(proof.declared_version, '3.0.0');
  assert.ok(proof.retained_bytes < proof.hosted_file_total_bytes);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, proof.retained_sample))).digest('hex'), proof.sample_sha256);
  assert.equal(observation.disposition, 'pointer-linked-archive-identity-metadata-confirmed-full-file-unvalidated');
  assert.match(observation.next_action, /streaming\/full-file usability check/);
  const view = loadReviewedView(audit);
  assert.notEqual(view.compliance.find(row => row.ccn === '180013').mrf_url, proof.hosted_file_url);
});
