'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('Beth Israel campus closure does not silently exempt a still-listed CCN', () => {
  const proof = read('reconciliation-beth-israel-campus-status-proof.json');
  const manual = read('reconciliation-manual-access-observations.json').records.find(row => row.ccn === proof.ccn);
  const verification = read('nationwide-verification.json').records.find(row => row.ccn === proof.ccn);
  const reconciliation = read('nationwide-reconciliation.json').records.find(row => row.ccn === proof.ccn);
  const queued = read('unresolved-investigation-worklist.json').records.find(row => row.ccn === proof.ccn);
  const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/mountsinai.org-51a980dd173b.txt'));
  assert.equal(proof.ccn, '330169');
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.retained_pointer_sha256);
  assert.equal(verification.pointer_corpus_sha256, proof.retained_pointer_sha256);
  assert.equal((pointer.toString().match(/^location-name:/gm) || []).length, 9);
  assert.doesNotMatch(pointer.toString(), /^location-name:.*(?:beth israel|downtown)/im);
  assert.equal(manual.proof_file, 'reconciliation-beth-israel-campus-status-proof.json');
  assert.equal(reconciliation.workstream, 'genuinely-unresolved-investigation');
  assert.equal(reconciliation.standing_finding, 'not-assessed-nationwide-pointer-facility-match-unresolved');
  assert.equal(queued.next_action, proof.next_action);
  assert.equal(queued.reviewed_follow_up, true);
  assert.ok(!queued.candidate_file_recorded);
});
