const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Stamford complete first-party alias file remains page-linked pending canonical pointer access', () => {
  const proof = JSON.parse(fs.readFileSync('data/hpt-audit/reconciliation-stamford-browser-enabled-file-proof.json', 'utf8'));
  assert.equal(proof.ccn, '070006');
  assert.equal(proof.complete_file_retrieval.http_status, 200);
  assert.equal(proof.complete_file_retrieval.bytes, 29723270);
  assert.equal(proof.complete_file_retrieval.sha256, '2ef241fff53ddfdfdcc9b581fbd9eaf8228c6f4acb64946f4aa11f41a230cf2b');
  assert.equal(proof.declared_hospital, 'Stamford Hospital');
  assert.match(proof.declared_address, /Stamford, CT/);
  assert.equal(proof.declared_version, '3.0.0');
  assert.equal(proof.pointer_linkage_status, 'root-target-www-host-blocked-alternate-first-party-content-host-readable');
  assert.equal(proof.disposition, 'complete-page-alias-file-identity-and-usability-confirmed-pointer-host-access-gap-retained');
});
