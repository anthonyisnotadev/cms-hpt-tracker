const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Coosa Valley third-party JSON corroborates identity but cannot promote incomplete metadata', () => {
  const proof = JSON.parse(fs.readFileSync('data/hpt-audit/reconciliation-coosa-valley-third-party-file-recheck-2026-09-19.json', 'utf8'));
  assert.equal(proof.ccn, '010164');
  assert.equal(proof.file_observation.http_status, 200);
  assert.equal(proof.file_observation.bytes, 18773456);
  assert.match(proof.file_observation.declared_hospital_name, /Coosa Valley Medical Center/);
  assert.equal(proof.file_observation.missing_root_metadata.includes('address'), true);
  const row = JSON.parse(fs.readFileSync('data/hpt-audit/nationwide-reconciliation.json', 'utf8')).records
    .find((entry) => entry.ccn === '010164');
  assert.equal(row.latest_observed_at, '2026-09-20T00:15:00Z');
  assert.equal(row.manual_access_observation.latest_third_party_file_recheck.metadata_incomplete, true);
  assert.match(row.next_action, /first-party root pointer/);
});
