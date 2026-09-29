const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const audit = path.join(root, 'data', 'hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-umms-current-price-page-campus-mrf-recheck-2026-09-27.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'));
const worklist = JSON.parse(fs.readFileSync(path.join(audit, 'unresolved-investigation-worklist.json'), 'utf8'));
const expected = ['210002', '210003', '210030', '210035', '210037', '210038', '210043', '210049', '210058', '210063'];

assert.deepEqual(proof.current_first_party_file_links.map(row => row.ccn), expected);
assert.equal(proof.current_first_party_file_links.length, 10);
assert.ok(proof.current_first_party_file_links.every(row => row.web_fetch_status === 403));
assert.equal(proof.browser_observation.includes('Cloudflare block page'), true);
assert.match(proof.pointer_check.direct_fetch_result, /before an HTTP response/);
assert.match(proof.scope_boundary, /No CSV bytes or headers were retrieved/);
assert.equal(proof.disposition_effect, 'none; all ten CCNs remain unresolved at their existing access/linkage gates');

for (const ccn of expected) {
  const row = manual.records.find(item => item.ccn === ccn);
  const queued = worklist.records.find(item => item.ccn === ccn);
  assert.ok(row, `manual evidence missing for ${ccn}`);
  assert.equal(row.latest_umms_page_link_recheck.proof_file, path.basename('reconciliation-umms-current-price-page-campus-mrf-recheck-2026-09-27.json'));
  assert.match(row.next_action, /Do not repeat the same blocked page\/file routes/);
  assert.ok(queued, `${ccn} must remain in the unresolved worklist`);
  assert.match(queued.next_action, /Do not repeat the same blocked page\/file routes/);
}

for (const row of proof.current_first_party_file_links.filter(item => item.direct_bounded_request)) {
  assert.equal(row.direct_bounded_request.status, 403);
  assert.equal(row.direct_bounded_request.response_bytes, 4543);
  assert.match(row.direct_bounded_request.response_sha256, /^[a-f0-9]{64}$/);
}

console.log('UMMS current link/access evidence reconciles to all ten unresolved CCNs without importing inaccessible content.');
