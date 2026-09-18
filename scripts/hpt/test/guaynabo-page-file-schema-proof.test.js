'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

test('Guaynabo page-linked CSV schema review does not promote a distinct pointer file', () => {
  const proof = read('data/hpt-audit/reconciliation-guaynabo-page-file-schema-proof.json');
  const manual = read('data/hpt-audit/reconciliation-manual-access-observations.json').records
    .find(row => row.ccn === '400122');
  const reconciliation = read('data/hpt-audit/nationwide-reconciliation.json').records
    .find(row => row.ccn === '400122');
  const queue = read('data/hpt-audit/standing-evidence-followup-worklist.json').records
    .find(row => row.ccn === '400122');

  assert.equal(manual.proof_file, 'reconciliation-guaynabo-page-file-schema-proof.json');
  assert.equal(manual.official_page_file_sha256, proof.page_file_sha256);
  assert.equal(manual.official_page_file_size_bytes, proof.page_file_bytes);
  assert.equal(proof.table_columns.length, 12);
  assert.equal(proof.populated_service_rows, 1315);
  assert.equal(proof.cms_root_hospital_address_field_present, false);
  assert.equal(proof.cms_root_last_updated_on_field_present, false);
  assert.equal(proof.cms_root_version_field_present, false);
  assert.notEqual(proof.page_file_url,
    read('data/hpt-audit/nationwide-verification.json').records
      .find(row => row.ccn === '400122').candidate_mrf_url);
  assert.equal(reconciliation.workstream, 'standing-evidence-follow-up');
  assert.equal(queue.current_disposition, 'mrf-request-unsuccessful');
  assert.match(queue.next_action, /Obtain a current first-party root pointer/);
  assert.doesNotMatch(queue.next_action, /review its full schema/);
});
