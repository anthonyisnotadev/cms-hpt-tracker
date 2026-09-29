'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('Quail Run live third-party candidate parse does not substitute for official linkage', () => {
  const proof = read('reconciliation-quail-run-live-third-party-candidate-recheck-2026-09-28.json');
  const manual = read('reconciliation-manual-access-observations.json').records.find(row => row.ccn === '034031');
  const worklist = read('unresolved-investigation-worklist.json').records.find(row => row.ccn === '034031');

  assert.equal(proof.live_retrieval.http_status, 200);
  assert.equal(proof.live_retrieval.bytes_read, proof.live_retrieval.content_length);
  assert.equal(proof.live_retrieval.sha256, '5b07409cf918c8783c47038608dbcf78f221aa807eae3e1bcb21cef371dcb4cc');
  assert.equal(proof.csv_validation.rate_rows, 829);
  assert.equal(proof.csv_validation.rows_with_expected_width, 829);
  assert.equal(proof.csv_validation.rows_with_numeric_negotiated_dollar, 829);
  assert.equal(proof.file_metadata.type_2_npi, '1740604636');
  assert.equal(proof.file_metadata.template_version, '3.0.0');
  assert.equal(proof.official_linkage_observation.exact_candidate_url_declared_by_official_source, false);
  assert.match(proof.disposition_effect, /none/);
  assert.equal(manual.latest_live_candidate_recheck_2026_09_28.proof_file,
    'reconciliation-quail-run-live-third-party-candidate-recheck-2026-09-28.json');
  assert.equal(worklist.current_disposition, 'pointer-access-denied-to-client');
  assert.match(worklist.next_action, /official Quail Run page\/pointer response or publisher confirmation/);
});
