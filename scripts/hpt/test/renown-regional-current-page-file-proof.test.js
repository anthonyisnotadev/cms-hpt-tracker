'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('Renown Regional keeps the current page-linked CSV separate from blocked file access', () => {
  const proof = read('data/hpt-audit/reconciliation-renown-regional-current-page-file-proof.json');
  const manual = read('data/hpt-audit/reconciliation-manual-access-observations.json').records
    .find(row => row.ccn === '290001');
  assert.equal(proof.ccn, '290001');
  assert.match(proof.official_page_observation, /Renown Regional Medical Center/);
  assert.match(proof.page_file_url, /regional-medical-center/);
  assert.match(proof.redirect_target_observed, /org=renown&loc=regional-medical-center/);
  assert.match(proof.page_file_transport_observation, /ERR_BLOCKED_BY_CLIENT/);
  assert.equal(proof.disposition, 'official-page-current-file-client-access-unresolved');
  assert.equal(manual.proof_file, 'reconciliation-renown-regional-current-page-file-proof.json');
});
