'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { extractDeclared } = require('../lib/probe');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const read = file => JSON.parse(fs.readFileSync(path.join(audit, file), 'utf8'));

test('Nor-Lea file remains unresolved across first-party link, 1900/1600 address conflict and HTML root', () => {
  const proof = read('reconciliation-nor-lea-address-conflict-proof.json');
  const sample = fs.readFileSync(path.join(root, proof.file.retained_sample));
  assert.equal(sample.length, 262144);
  assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), proof.file.sample_sha256);
  assert.equal(extractDeclared(sample, 'csv').address,
    '1900 North Main Avenue, Lovington, NM 88260-2813');
  assert.equal(proof.roster.address, '1600 NORTH MAIN AVE');
  assert.equal(proof.browser_observation.first_party_page_links_exact_file, true);
  assert.match(proof.browser_observation.pointer_result, /HTML page/);
  const reviewed = read('reconciliation-reviewed-header-dispositions.json').records
    .find(row => row.ccn === proof.ccn);
  assert.equal(reviewed.disposition, 'current-official-address-conflicts-with-file');
  assert.equal(reviewed.fresh_file_sample_sha256, proof.file.sample_sha256);
  const current = read('nationwide-verification.json').records.find(row => row.ccn === proof.ccn);
  assert.notEqual(current.disposition, 'verified-current-mrf');
  const work = read('unresolved-investigation-worklist.json').records.find(row => row.ccn === proof.ccn);
  assert.ok(work.reviewed_follow_up);
  assert.ok(work.latest_review_at >= proof.observed_at);
  assert.match(work.next_action, /1900 North Main/);
  assert.match(work.next_action, /1900 North Main|root cms-hpt\.txt|publisher clarification/i);
});
