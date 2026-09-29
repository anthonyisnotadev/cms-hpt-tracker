'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');

test('Grove Creek full-file recheck strengthens the shared-file quarantine', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-grove-creek-shared-file-full-recheck-proof.json')));
  assert.equal(proof.ccn, '130073');
  assert.equal(proof.http_status, 200);
  assert.equal(proof.bytes, 23598385);
  assert.equal(proof.declared_hospital_name, 'BINGHAM MEMORIAL HOSPITAL');
  assert.equal(proof.declared_address, '98 Poplar St Blackfoot ID 83221');
  assert.equal(proof.full_file_contains_grove_creek, false);
  assert.equal(proof.full_file_contains_grove_creek_address, false);
  const resolution = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json')))
    .find(row => row.ccn === '130073');
  assert.equal(resolution.action, 'quarantine');
  assert.equal(resolution.evidence.latest_full_file_recheck_proof,
    'reconciliation-grove-creek-shared-file-full-recheck-proof.json');
  assert.equal(resolution.evidence.latest_full_file_contains_grove_creek, false);
});
