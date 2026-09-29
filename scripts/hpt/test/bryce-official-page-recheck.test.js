'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = (name) => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('Bryce current official-page recheck remains a dated lead check, not MRF or compliance evidence', () => {
  const proof = read('reconciliation-bryce-official-page-recheck-2026-09-28.json');
  assert.equal(proof.ccn, '014007');
  assert.equal(proof.file_bytes_recovered, false);
  assert.equal(proof.pointer_linkage_established, false);
  assert.equal(proof.count_effect, 0);
  assert.match(proof.next_action, /do not contact ADMH without authorization/);

  const row = read('nationwide-reconciliation.json').records.find((item) => item.ccn === proof.ccn);
  assert.equal(row.workstream, 'genuinely-unresolved-investigation');
  assert.equal(row.manual_access_observation.latest_official_page_recheck_2026_09_28.proof_file,
    'reconciliation-bryce-official-page-recheck-2026-09-28.json');
  assert.equal(row.next_action, proof.next_action);

  const worklist = read('unresolved-investigation-worklist.json');
  assert.equal(worklist.records.find((item) => item.ccn === proof.ccn).next_action, proof.next_action);
});
