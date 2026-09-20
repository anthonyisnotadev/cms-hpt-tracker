'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

test('Westborough retained shared pointer does not assign a sibling file to CCN 224044', () => {
  const proof = read('data/hpt-audit/reconciliation-westborough-shared-pointer-exclusion-proof.json');
  const pointer = fs.readFileSync(path.join(root, proof.retained_pointer_file));
  assert.equal(pointer.length, proof.retained_pointer_bytes);
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.retained_pointer_sha256);
  const contents = pointer.toString('utf8');
  const names = [...contents.matchAll(/^location-name:\s*(.*)$/gm)].map(match => match[1]);
  assert.deepEqual(names, proof.retained_pointer_location_names);
  assert.equal(names.length, proof.retained_pointer_entry_count);
  assert.equal(names.filter(name => /westborough/i.test(name)).length, 0);
  assert.doesNotMatch(contents, /westborough|massachusetts|\bMA\b/i);
  assert.match(proof.current_root_web_open_result, /not established/i);
  assert.equal(proof.latest_live_pointer_recheck.http_status, 200);
  assert.equal(proof.latest_live_pointer_recheck.entry_count, 10);
  assert.equal(proof.latest_live_pointer_recheck.westborough_entry_count, 0);

  const manual = read('data/hpt-audit/reconciliation-manual-access-observations.json').records
    .find(row => row.ccn === proof.ccn);
  const reconciliation = read('data/hpt-audit/nationwide-reconciliation.json').records
    .find(row => row.ccn === proof.ccn);
  const queue = read('data/hpt-audit/unresolved-investigation-worklist.json').records
    .find(row => row.ccn === proof.ccn);
  assert.equal(manual.proof_file, 'reconciliation-westborough-shared-pointer-exclusion-proof.json');
  assert.equal(manual.latest_live_pointer_recheck.sha256, proof.retained_pointer_sha256);
  assert.equal(reconciliation.workstream, 'genuinely-unresolved-investigation');
  assert.equal(queue.evidence_gate, 'pointer-facility-match');
  assert.match(queue.next_action, /do not assign one of the ten retained out-of-state sibling entries/i);
});
