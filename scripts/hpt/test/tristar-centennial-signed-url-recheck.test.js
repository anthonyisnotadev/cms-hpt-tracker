const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('TriStar Centennial signed URL retry retains token failure without a file claim', () => {
  const proof = JSON.parse(fs.readFileSync('data/hpt-audit/reconciliation-tristar-centennial-signed-url-recheck-2026-09-19.json', 'utf8'));
  assert.equal(proof.ccn, '440161');
  assert.equal(proof.http_status, 403);
  assert.equal(proof.bytes_retrieved, 0);
  assert.equal(proof.query_withheld, true);
  const row = JSON.parse(fs.readFileSync('data/hpt-audit/nationwide-reconciliation.json', 'utf8')).records
    .find((entry) => entry.ccn === '440161');
  assert.equal(row.latest_observed_at, '2026-09-19T23:45:00Z');
  assert.equal(row.manual_access_observation.latest_signed_url_recheck.disposition, 'signed-file-token-invalid-no-file-claim');
  assert.match(row.next_action, /replacement token or unsuffixed authorized route/);
});
