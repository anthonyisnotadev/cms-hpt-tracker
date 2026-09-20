'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('UCSD Hillcrest retains a concrete current page/file lead without bytes', () => {
  const proof = read('data/hpt-audit/reconciliation-ucsd-hillcrest-current-page-file-proof.json');
  const manual = read('data/hpt-audit/reconciliation-manual-access-observations.json').records
    .find(row => row.ccn === '050025');
  assert.equal(proof.ccn, '050025');
  assert.match(proof.official_page_observation, /machine-readable JSON/);
  assert.match(proof.page_file_url, /UC-San-Diego-Standard-Charges-956006144\.json/);
  assert.match(proof.page_file_transport_observation, /JSON bytes were obtained/);
  assert.equal(proof.disposition, 'official-page-current-large-json-link-access-unresolved');
  assert.equal(manual.proof_file, 'reconciliation-ucsd-hillcrest-current-page-file-proof.json');
  assert.match(manual.next_action, /authorized download-capable route/);
});
