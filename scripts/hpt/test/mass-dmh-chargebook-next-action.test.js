'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));
const proof = read('reconciliation-mass-dmh-fy26-chargebooks-proof.json');
const manual = read('reconciliation-manual-access-observations.json').records;
const reconciliation = read('nationwide-reconciliation.json').records;
const worklist = read('unresolved-investigation-worklist.json').records;
const verification = read('nationwide-verification.json').records;

assert.deepEqual(proof.records.map(record => record.ccn).sort(),
  ['224001', '224028', '224031', '224040']);
for (const source of proof.records) {
  assert.equal(source.file_type, 'FY26 state chargebook CSV, not CMS-template MRF');
  assert.match(source.file_sha256, /^[A-F0-9]{64}$/);
  const ccn = source.ccn;
  const manualRow = manual.find(record => record.ccn === ccn);
  const reconciled = reconciliation.find(record => record.ccn === ccn);
  const queued = worklist.find(record => record.ccn === ccn);
  const snapshot = verification.find(record => record.ccn === ccn);
  assert.equal(manualRow.proof_file, 'reconciliation-mass-dmh-fy26-chargebooks-proof.json');
  assert.equal(manualRow.disposition, 'official-state-custom-chargebook-confirmed-cms-mrf-unresolved');
  assert.equal(reconciled.next_action, queued.next_action,
    `reconciliation drops the non-CMS chargebook context for ${ccn}`);
  assert.match(reconciled.next_action, /retain the official FY26 chargebook as non-CMS evidence/i);
  assert.match(reconciled.next_action, /facility-specific CMS-template MRF or pointer/i);
  assert.equal(snapshot.disposition, 'pointer-discovery-incomplete');
  assert.notEqual(snapshot.disposition, 'verified-current-mrf');
}

console.log('Massachusetts DMH chargebook next-action tests passed.');
