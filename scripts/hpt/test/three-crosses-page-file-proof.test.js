'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parsePayload } = require('../lib/recovery-transport');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Three Crosses page-linked CSV remains unresolved with license-state conflict', async () => {
  const proof = require(path.join(audit, 'reconciliation-three-crosses-page-file-proof.json'));
  const observation = require(path.join(audit, 'reconciliation-manual-access-observations.json'))
    .records.find(row => row.ccn === '320091');
  const rawPointer = fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/raw/threecrossesregional.com-f64d6970b178.txt'));
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(crypto.createHash('sha256').update(rawPointer).digest('hex'), proof.pointer_sha256);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.sample_sha256);
  assert.equal(sample.length, 262144);
  assert.ok(proof.file_total_bytes > sample.length);
  assert.ok(proof.pointer_entry_without_contacts.includes(`mrf-url: ${proof.first_party_pricing_page_url}`));
  assert.notEqual(proof.first_party_pricing_page_url, proof.pricing_page_file_url);
  const parsed = (await parsePayload(sample, 'text/csv')).parsed.find(item => item.innerKind === 'csv');
  assert.equal(parsed.mrfHospitalName, 'Three Crosses Regional Hospital LLC');
  assert.equal(parsed.mrfAddress, '2560  Samaritan Drive, Las Cruces, NM 88001');
  assert.equal(parsed.mrfLicenseState, 'CA');
  assert.equal(parsed.declaredLastUpdated, '2024-11-07');
  assert.equal(parsed.cmsVersion, '2.0.0');
  assert.equal(proof.roster_state, 'NM');
  assert.equal(observation.page_file_sample_sha256, proof.sample_sha256);
  assert.match(observation.next_action, /reconcile the CSV license state CA/);
  const row = loadReviewedView(audit).compliance.find(item => item.ccn === '320091');
  assert.equal(row.finding, 'not-assessed-nationwide-pointer-facility-match-unresolved');
  assert.notEqual(row.mrf_url, proof.pricing_page_file_url);
  const worklist = require(path.join(audit, 'unresolved-investigation-worklist.json')).records
    .find(item => item.ccn === '320091');
  assert.equal(worklist.reviewed_follow_up, true);
  assert.equal(worklist.candidate_file_recorded, true);
  assert.match(worklist.next_action, /reconcile the CSV license state CA/);
});
