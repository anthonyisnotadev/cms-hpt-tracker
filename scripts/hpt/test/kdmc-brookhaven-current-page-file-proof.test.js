'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('KDMC Brookhaven retains its official page/file lead without promoting a 403', () => {
  const proof = read('data/hpt-audit/reconciliation-kdmc-brookhaven-current-page-file-proof.json');
  const manual = read('data/hpt-audit/reconciliation-manual-access-observations.json').records
    .find(row => row.ccn === '250057');
  assert.equal(proof.ccn, '250057');
  assert.match(proof.official_page_observation, /Brookhaven, Mississippi/);
  assert.match(proof.page_file_url, /640333594_Kings_Daughters_Medical_Center_StandardCharges\.csv/);
  assert.match(proof.page_file_transport_observation, /HTTP 403/);
  assert.equal(proof.disposition, 'official-page-current-file-client-access-unresolved');
  assert.equal(manual.proof_file, 'reconciliation-kdmc-brookhaven-current-page-file-proof.json');
});
