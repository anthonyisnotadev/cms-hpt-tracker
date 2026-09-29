const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Minidoka current pointer is content-bearing but its exact target remains a publisher 404', () => {
  const proof = JSON.parse(fs.readFileSync('data/hpt-audit/reconciliation-minidoka-pointer-404-recheck-proof.json', 'utf8'));
  assert.equal(proof.ccn, '131319');
  assert.equal(proof.pointer_http_status, 200);
  assert.equal(proof.pointer_target_http_status, 404);
  assert.equal(proof.pointer_target_content_type, 'text/html; charset=UTF-8');
  assert.equal(proof.pointer_sha256, '58f6274eb8dd1ac051c53251b06c460d6dd910e1b18a1070d52bcb86564bb081');
  assert.match(proof.latest_web_recheck.result, /fresh bounded curl/);
});
