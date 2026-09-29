const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Nor-Lea complete current file preserves the documented address conflict', () => {
  const proof = JSON.parse(fs.readFileSync('data/hpt-audit/reconciliation-nor-lea-address-conflict-proof.json', 'utf8'));
  const r = proof.latest_complete_recheck;
  assert.equal(r.file_http_status, 200);
  assert.equal(r.file_bytes, 11230287);
  assert.equal(r.file_sha256.toLowerCase(), '549aee_bd73a2ec8cb6ba28c75e1af7b31380db81b6597d042c8b0a821dcc151e'.replace('_',''));
  assert.equal(r.declared_hospital_name, 'Nor-Lea Hospital District');
  assert.equal(r.declared_license_state, 'NM');
  assert.equal(r.template_version, '3.0.0');
  assert.match(r.declared_address, /1900 North Main/);
  assert.match(r.result, /conflicts with the roster/);
});
