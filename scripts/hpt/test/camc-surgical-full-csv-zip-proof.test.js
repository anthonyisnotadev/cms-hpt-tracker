'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validate } = require('../capture-camc-surgical-full-file-proof');

const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('CAMC Surgical complete page CSV remains separate from its broken pointer target', () => {
  const proof = read('data/hpt-audit/reconciliation-camc-surgical-full-csv-zip-proof.json');
  const parsed = validate(fs.readFileSync(path.join(root, proof.retained_file)));
  assert.equal(parsed.sha256, proof.page_file_sha256);
  assert.equal(parsed.bytes, proof.page_file_bytes);
  assert.equal(parsed.csv_rows, proof.csv_rows_total);
  assert.equal(parsed.columns_per_row, proof.csv_columns_per_row);
  assert.equal(parsed.declared_address, proof.declared_address);
  assert.equal(proof.pointer_target_head_status, 404);
  assert.equal(proof.page_file_complete_get_status, 200);
  assert.notEqual(proof.pointer_target_url, proof.page_file_url);
  assert.equal(proof.official_identity_address.slice(-5), '25301');
  assert.equal(proof.state_sos_designated_and_principal_zip, '25301');
  assert.equal(proof.declared_address.slice(-5), '25303');

  const manual = read('data/hpt-audit/reconciliation-manual-access-observations.json').records
    .find(row => row.ccn === proof.ccn);
  const reconciliation = read('data/hpt-audit/nationwide-reconciliation.json').records
    .find(row => row.ccn === proof.ccn);
  const queue = read('data/hpt-audit/unresolved-investigation-worklist.json').records
    .find(row => row.ccn === proof.ccn);
  assert.equal(manual.complete_file_proof, 'reconciliation-camc-surgical-full-csv-zip-proof.json');
  assert.equal(manual.official_page_file_complete_sha256, proof.page_file_sha256);
  assert.equal(reconciliation.workstream, 'consistent');
  assert.equal(queue, undefined);
  const ledger = read('data/hpt-audit/reviewed-resolutions.json').find(row => row.ccn === proof.ccn);
  assert.equal(ledger.action, 'replace');
  assert.equal(ledger.evidence.observedFinding, 'compliant-observed');
});
