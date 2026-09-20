const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const proof = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/reconciliation-mount-grant-current-page-pdf-proof.json'), 'utf8'));

test('Mount Grant deleted pointer target remains distinct from custom PDF evidence', () => {
  assert.equal(proof.ccn, '291300');
  assert.equal(proof.pointer_mrf_http_status, 404);
  assert.equal(proof.page_file_role, 'official shoppable-services/custom PDF, not a current CMS-template CSV/JSON MRF');
  assert.equal(proof.latest_publisher_repository_recheck.disposition, 'publisher-link-deletion-retained-no-mrf-promotion');
  assert.match(proof.latest_publisher_repository_recheck.observed_result, /deleted in commit c60d9c9/);
  assert.match(proof.latest_publisher_repository_recheck.interpretation, /does not establish current file absence/);
});
