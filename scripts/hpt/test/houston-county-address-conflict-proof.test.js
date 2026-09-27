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

test('Houston County complete pointer-and-page CSV retains conflicting campus address', async () => {
  const proof = require(path.join(audit, 'reconciliation-houston-county-address-conflict-proof.json'));
  const observation = require(path.join(audit, 'reconciliation-manual-access-observations.json'))
    .records.find(row => row.ccn === '441322');
  const nationwide = require(path.join(audit, 'nationwide-verification.json'))
    .records.find(row => row.ccn === '441322');
  const roster = require(path.join(root, 'cms_data/hpt/roster.json')).find(row => row.ccn === '441322');
  const file = fs.readFileSync(path.join(root, proof.retained_file));
  const retainedPointer = fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/raw/shamrock.health-8f8443d5652a.txt'));
  const safeLines = retainedPointer.toString('utf8').split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  assert.equal(crypto.createHash('sha256').update(file).digest('hex'), proof.file_sha256);
  assert.equal(file.length, proof.file_total_bytes);
  assert.equal(crypto.createHash('sha256').update(retainedPointer).digest('hex'), proof.retained_pointer_sha256);
  assert.equal(proof.pointer_sha256, nationwide.pointer_corpus_sha256);
  const obfuscation = require(path.join(audit, 'pointer-obfuscation.json')).entries
    .find(row => row.file.replaceAll('\\', '/').endsWith('/shamrock.health.txt'));
  assert.equal(obfuscation.plaintextSha256, proof.pointer_sha256);
  assert.equal(obfuscation.storedSha256, proof.retained_pointer_sha256);
  assert.equal(proof.retained_pointer_obfuscated, true);
  assert.deepEqual(safeLines, proof.pointer_entry_without_contacts);
  assert.equal(proof.pointer_safe_fields_same_as_retained, true);
  assert.equal(proof.pointer_and_page_file_url, observation.pointer_mrf_url);
  assert.equal(observation.page_file_url, observation.pointer_mrf_url);
  const parsed = (await parsePayload(file, 'text/csv')).parsed.find(item => item.innerKind === 'csv');
  assert.equal(parsed.mrfHospitalName, 'Houston County Community Hospital');
  assert.equal(parsed.mrfLocationName, 'Houston County Community Hopsital');
  assert.equal(parsed.mrfAddress, '200 West Church St, Lexington, TN 38351');
  assert.equal(parsed.mrfLicenseState, 'TN');
  assert.equal(parsed.declaredLastUpdated, '2026-06-30');
  assert.equal(parsed.cmsVersion, '3.0.0');
  assert.equal(roster.address, '5001 EAST MAIN STREET');
  assert.equal(proof.pricing_page_facility_address, '5001 East Main Street, Erin, TN 37061');
  const rows = parseCSV(file.toString('utf8'));
  assert.equal(rows.length, proof.csv_rows);
  assert.ok(rows.every(row => row.length === proof.columns_per_row));
  const tracker = loadReviewedView(audit).compliance.find(item => item.ccn === '441322');
  assert.equal(tracker.finding, 'not-assessed-nationwide-linked-mrf-header-unmatched');
  const worklist = require(path.join(audit, 'unresolved-investigation-worklist.json')).records
    .find(item => item.ccn === '441322');
  assert.equal(worklist.reviewed_follow_up, true);
  assert.equal(worklist.current_disposition, 'linked-mrf-header-unmatched');
  assert.equal(nationwide.disposition, 'linked-mrf-header-unmatched');
  assert.equal(worklist.evidence_gate, 'file-header');
  assert.match(worklist.next_action, /Lexington address/);
});
