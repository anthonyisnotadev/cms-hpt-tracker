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

test('Reedsburg pointer 404 remains distinct from identity-matched page CSV', async () => {
  const proof = require(path.join(audit, 'reconciliation-reedsburg-pointer-case-proof.json'));
  const observation = require(path.join(audit, 'reconciliation-manual-access-observations.json'))
    .records.find(row => row.ccn === '521351');
  const nationwide = require(path.join(audit, 'nationwide-verification.json'))
    .records.find(row => row.ccn === '521351');
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.sample_sha256);
  assert.equal(sample.length, 262144);
  assert.ok(proof.page_file_total_bytes > sample.length);
  assert.equal(proof.pointer_sha256, nationwide.pointer_corpus_sha256);
  assert.ok(proof.pointer_entry_without_contacts.includes(`mrf-url: ${proof.pointer_file_url}`));
  assert.notEqual(proof.pointer_file_url, proof.page_file_url);
  assert.equal(proof.pointer_file_http_status, 404);
  assert.equal(proof.page_file_http_status, 206);
  const parsed = (await parsePayload(sample, 'text/csv')).parsed.find(item => item.innerKind === 'csv');
  assert.equal(parsed.mrfHospitalName, 'Reedsburg Area Medical Center');
  assert.equal(parsed.mrfAddress, '2000 N Dewey Ave, Reedsburg, WI 53959');
  assert.equal(parsed.mrfLicenseState, 'WI');
  assert.equal(parsed.declaredLastUpdated, '2026-02-20');
  assert.equal(parsed.cmsVersion, '3.0.0');
  assert.equal(observation.page_file_sample_sha256, proof.sample_sha256);
  const row = loadReviewedView(audit).compliance.find(item => item.ccn === '521351');
  assert.equal(row.finding, 'pointer-links-unavailable-mrf-source-page-current-file');
  assert.equal(row.mrf_url, proof.page_file_url);
  assert.equal(row.pointer_url, proof.pointer_url);
  const worklist = require(path.join(audit, 'unresolved-investigation-worklist.json')).records
    .find(item => item.ccn === '521351');
  assert.equal(worklist, undefined);
  const standing = require(path.join(audit, 'standing-evidence-followup-worklist.json')).records
    .find(item => item.ccn === '521351');
  assert.equal(standing.reviewed_follow_up, true);
  assert.equal(standing.current_disposition, nationwide.disposition);
  assert.equal(standing.standing_finding, row.finding);
  assert.match(standing.next_action, /case-sensitive correction/);
});
