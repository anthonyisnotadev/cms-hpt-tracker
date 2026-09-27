const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-highlands-page-file-proof.json'), 'utf8'));
const resolutions = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reviewed-resolutions.json'), 'utf8'));

test('Highlands complete page-linked file is identity-matched while pointer linkage remains pending', () => {
  assert.equal(proof.ccn, '010061');
  assert.equal(proof.http_status, 200);
  assert.equal(proof.bytes, 29707015);
  assert.equal(proof.declared_hospital_name, 'Highlands Medical Center');
  assert.match(proof.declared_address, /Scottsboro, AL 35768/);
  assert.equal(proof.declared_license_state, 'AL');
  assert.equal(proof.declared_version, '3.0.0');
  const row = resolutions.find((entry) => entry.ccn === '010061');
  assert.equal(row.action, 'replace-observation');
  assert.equal(row.finding, 'official-page-mrf-pointer-linkage-pending');
  assert.equal(row.evidence.fileSha256, proof.sha256);
  const reconciliation = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-reconciliation.json'), 'utf8'))
    .records.find((entry) => entry.ccn === '010061');
  assert.match(reconciliation.latest_observed_at, /^2026-09-26T/);
  assert.equal(reconciliation.manual_access_observation.latest_browser_access_recheck.pointer_browser_status, 'dns-resolution-failure');
  assert.match(reconciliation.next_action, /Retry the exact Highlands root pointer/);
});
