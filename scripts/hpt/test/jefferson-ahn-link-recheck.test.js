const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-jefferson-hospital-ahn-link-recheck-proof.json'), 'utf8'));
const resolutions = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reviewed-resolutions.json'), 'utf8'));

test('Jefferson AHN link recheck retains Pennsylvania identity quarantine', () => {
  assert.equal(proof.ccn, '110100');
  assert.equal(proof.status, 'transport-unverified');
  assert.equal(proof.disposition, 'identity-quarantine-retained');
  assert.match(proof.linked_mrf_url, /251260215_jefferson-regional-medical-center_standardcharges\.csv$/);
  const row = resolutions.find((entry) => entry.ccn === '110100');
  assert.equal(row.action, 'quarantine');
  assert.equal(row.proof.latest_ahn_link_recheck_status, 'transport-unverified');
  assert.equal(row.proof.latest_ahn_link_recheck_disposition, 'identity-quarantine-retained');
});
