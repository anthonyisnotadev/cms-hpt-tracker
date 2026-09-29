'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parsePayload } = require('../lib/recovery-transport');
const { parseCSV } = require('../lib/util');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('Coal County page CSV has exact facility metadata but is not the Google Sheets pointer target', async () => {
  const proof = require(path.join(audit, 'reconciliation-coal-county-page-file-proof.json'));
  const observation = require(path.join(audit, 'reconciliation-manual-access-observations.json'))
    .records.find(row => row.ccn === '371319');
  const nationwide = require(path.join(audit, 'nationwide-verification.json'))
    .records.find(row => row.ccn === '371319');
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.sample_sha256);
  assert.equal(sample.length, 262144);
  assert.ok(proof.file_total_bytes > sample.length);
  assert.equal(proof.pointer_sha256, nationwide.pointer_corpus_sha256);
  assert.ok(proof.pointer_entry_without_contacts.includes(`mrf-url: ${proof.pointer_target_url}`));
  assert.notEqual(proof.pointer_target_url, proof.pricing_page_file_url);
  assert.match(proof.pointer_target_url, /docs\.google\.com\/spreadsheets\/d\//);
  const parsed = (await parsePayload(sample, 'text/csv')).parsed.find(item => item.innerKind === 'csv');
  assert.equal(parsed.mrfHospitalName, 'Coal County General Hospital');
  assert.equal(parsed.mrfAddress, '6 North Covington Street, Coalgate, OK, 74538');
  assert.equal(parsed.mrfLicenseState, 'OK');
  assert.equal(parsed.declaredLastUpdated, '2026-03-30');
  assert.equal(parsed.cmsVersion, '3.0.0');
  const complete = fs.readFileSync(path.join(root, proof.complete_file.retained_file));
  assert.equal(complete.length, proof.file_total_bytes);
  assert.equal(crypto.createHash('sha256').update(complete).digest('hex'), proof.complete_file.sha256);
  assert.equal(crypto.createHash('sha256').update(complete.subarray(0, sample.length)).digest('hex'), proof.sample_sha256);
  const rows = parseCSV(complete.toString('utf8'));
  assert.equal(rows.length, proof.complete_file.csv_rows);
  assert.equal(proof.complete_file.service_rows_after_metadata_and_header, rows.length - 3);
  assert.ok(rows.every(row => row.length === proof.complete_file.columns_per_row));
  assert.equal(observation.page_file_sample_sha256, proof.sample_sha256);
  const row = loadReviewedView(audit).compliance.find(item => item.ccn === '371319');
  assert.equal(row.finding, 'pointer-target-google-sheet-page-file-found');
  assert.equal(row.mrf_url, proof.pricing_page_file_url);
  assert.notEqual(proof.pointer_target_url, row.mrf_url);
  const worklist = require(path.join(audit, 'standing-evidence-followup-worklist.json')).records
    .find(item => item.ccn === '371319');
  assert.equal(worklist.reviewed_follow_up, true);
  assert.equal(worklist.standing_finding, 'pointer-target-google-sheet-page-file-found');
  assert.equal(worklist.current_disposition, nationwide.disposition);
  assert.match(worklist.next_action, /direct CSV\/JSON MRF target/);
});
