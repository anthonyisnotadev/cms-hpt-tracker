'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../build-unresolved-investigation-worklist');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('UNC Southeastern alias is supported without promoting either inaccessible file', () => {
  const proof = read('reconciliation-unc-southeastern-alias-access-proof.json');
  const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/unchealth.org-94610d032f4c.txt'));
  const verification = read('nationwide-verification.json');
  const reconciliation = read('nationwide-reconciliation.json');
  const current = verification.records.find(row => row.ccn === proof.ccn);
  const review = reconciliation.records.find(row => row.ccn === proof.ccn);
  const queued = read('unresolved-investigation-worklist.json').records.find(row => row.ccn === proof.ccn);
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.retained_pointer_sha256);
  assert.equal(current.pointer_corpus_sha256, proof.retained_pointer_sha256);
  assert.equal(review.workstream, 'genuinely-unresolved-investigation');
  assert.equal(proof.official_pricing_page_file_bounded_range_status, 403);
  assert.equal(proof.file_metadata_verified, false);
  assert.equal(queued.current_disposition, proof.disposition);
  assert.equal(queued.nationwide_disposition, 'pointer-facility-match-unresolved');
  assert.equal(queued.evidence_gate, 'pointer-and-page-file-access-and-header');
  assert.equal(queued.next_action, proof.next_action);
  assert.equal(queued.candidate_file_recorded, true);
  assert.ok(!JSON.stringify(proof).includes('recno='));
  const changed = structuredClone(verification);
  changed.records.find(row => row.ccn === proof.ccn).pointer_corpus_sha256 = '0'.repeat(64);
  assert.equal(build(reconciliation, changed).records.find(row => row.ccn === proof.ccn).current_disposition,
    'pointer-facility-match-unresolved');
});
