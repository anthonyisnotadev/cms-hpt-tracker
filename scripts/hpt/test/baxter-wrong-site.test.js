'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-baxter-wrong-site-proof.json'));
const ledger = require(path.join(audit, 'reviewed-resolutions.json'));

test('Baxter keeps the unrelated Indiana pointer excluded while its CMS scope exception remains unproven', () => {
  const pointer = fs.readFileSync(path.join(root, proof.previous_pointer_artifact));
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.previous_pointer_sha256);
  assert.doesNotMatch(pointer.toString('utf8'), /Baxter|Grand Oaks|Minnesota/i);
  const resolution = ledger.find(row => row.ccn === '244015');
  assert.equal(resolution.action, 'scope-review-pending');
  assert.equal(resolution.scope_review.status, 'state-hospital-exception-not-established');
  assert.equal(resolution.official.domain, 'mn.gov');
  assert.equal(resolution.evidence.scopeProof, 'reconciliation-baxter-minnesota-state-hospital-scope-proof-2026-09-28.json');
  assert.equal(resolution.evidence.historicalIdentityReview, 'reconciliation-baxter-wrong-site-proof.json');
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '244015');
  assert.equal(row.domain, 'ecommunity.com');
  assert.notEqual(row.finding, 'not-applicable-state-hospital');
  assert.equal(row.pointer_url, 'https://ecommunity.com/cms-hpt.txt');
  assert.equal(row.mrf_url, '');
  assert.equal(view.history['244015'].domain, 'ecommunity.com');
  const nationwide = require(path.join(audit, 'nationwide-verification.json')).records.find(item => item.ccn === '244015');
  assert.notEqual(nationwide.official_domain, 'mn.gov');
  assert.equal(nationwide.mrf_url, '');
  const reconciled = require(path.join(audit, 'nationwide-reconciliation.json')).records.find(item => item.ccn === '244015');
  assert.equal(reconciled.latest_observation_superseded, false);
  assert.equal(reconciled.workstream, 'genuinely-unresolved-investigation');
  assert.match(reconciled.next_action, /Baxter-specific.*pricing\/file/i);
});
