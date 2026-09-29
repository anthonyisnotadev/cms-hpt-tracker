'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { manualPageFileRecheck } = require('../build-nationwide-verification');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-roger-williams-current-page-file-proof-2026-09-28.json';

test('Roger Williams full page-linked MRF is verified without inventing root-pointer linkage', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
  const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'));
  const observation = manual.records.find(record => record.ccn === '410004');
  const review = manualPageFileRecheck(observation);
  assert.ok(review);
  assert.equal(proof.file_bytes, 75510646);
  assert.equal(proof.file_sha256, 'a0b27d500a70c9545a1b0b985043e9cfd32452db8f5d4f52cdbc9b2ec183ef4d');
  assert.equal(proof.logical_csv_rows, 318201);
  assert.equal(proof.rows_with_negotiated_dollar_amount, 182173);
  assert.equal(review.manual_file_only, true);
  assert.equal(review.pointer_declared_mrf_url, proof.facility_file_url);
  assert.equal(review.declared_hospital_name, 'Prospect CharterCare RWMC, LLC');
  assert.equal(review.declared_location_name, 'CharterCARE Health Partners at Roger Williams');
  assert.equal(review.declared_address, '825 Chalkstone Avenue, Providence, RI 02908');
  assert.equal(review.declared_license_state, 'RI');
  assert.equal(review.declared_npi, '1013332014');
  assert.equal(review.declared_last_updated, '2026-01-01');
  assert.equal(review.cms_template_version, '3.0.0');
  assert.equal(review.attestation, true);
  assert.equal(review.manual_disposition, 'verified-current-mrf');
  assert.equal(observation.pointer_url, '');

  const snapshot = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'));
  const row = snapshot.records.find(record => record.ccn === '410004');
  assert.equal(row.disposition, 'verified-current-mrf');
  assert.equal(row.mrf_state, 'page-linked-file-retrieved');
  assert.equal(row.mrf_url, proof.facility_file_url);
  assert.equal(row.file_sample_bytes, proof.file_bytes);
  assert.equal(row.file_sample_sha256, proof.file_sha256);
  assert.notEqual(row.pointer_state, 'retrieved-facility-linked');

  const html = fs.readFileSync(path.join(root, 'tracker.html'), 'utf8');
  const marker = '<script id="tracker-data" type="application/json">';
  const start = html.indexOf(marker);
  const end = html.indexOf('</script>', start + marker.length);
  const tracker = JSON.parse(html.slice(start + marker.length, end));
  const trackerRow = tracker.rows.find(item => item[0] === '410004');
  assert.equal(trackerRow[8], proof.facility_file_url);
  assert.equal(trackerRow[13], proof.declared_last_updated);
  assert.equal(trackerRow[18], proof.official_pricing_page);

  const crosswalk = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-891-baseline-member-roster-2026-09-27.json'), 'utf8'));
  assert.ok(crosswalk.current_crosswalk_ccns['active-verification-claim'].includes('410004'));
  assert.ok(!crosswalk.current_crosswalk_ccns['genuinely-unresolved'].includes('410004'));
});
