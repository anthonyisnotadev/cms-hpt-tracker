'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));

test('Hereford keeps nonstandard pointer field and distinct page files separate', () => {
  const proof = read('reconciliation-hereford-two-file-proof.json');
  const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/dschd.org-5c4e2db86eed.txt'));
  const verification = read('nationwide-verification.json').records.find(row => row.ccn === proof.ccn);
  const reconciliation = read('nationwide-reconciliation.json').records.find(row => row.ccn === proof.ccn);
  const queued = read('unresolved-investigation-worklist.json').records.find(row => row.ccn === proof.ccn);
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.pointer_sha256);
  assert.equal(verification.pointer_corpus_sha256, proof.pointer_sha256);
  assert.match(pointer.toString(), /^url: /m);
  assert.doesNotMatch(pointer.toString(), /^mrf-url:/m);
  assert.notEqual(proof.pointer_url_field_file_url, proof.page_patient_pricing_tool_file_url);
  assert.equal(proof.pointer_url_field_file_declared_version, '2.0.0');
  assert.equal(proof.page_patient_pricing_tool_file_declared_version, '3.0.0');
  assert.equal(reconciliation.workstream, 'genuinely-unresolved-investigation');
  assert.equal(queued.next_action, proof.next_action);
  assert.equal(queued.reviewed_follow_up, true);
});
