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

test('Baxter excludes unrelated Indiana pointer without asserting a Minnesota MRF result', () => {
  const pointer = fs.readFileSync(path.join(root, proof.previous_pointer_artifact));
  assert.equal(crypto.createHash('sha256').update(pointer).digest('hex'), proof.previous_pointer_sha256);
  assert.doesNotMatch(pointer.toString('utf8'), /Baxter|Grand Oaks|Minnesota/i);
  const resolution = ledger.find(row => row.ccn === '244015');
  assert.equal(resolution.action, 'quarantine');
  assert.equal(resolution.official.domain, 'mn.gov');
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '244015');
  assert.equal(row.domain, 'mn.gov');
  assert.equal(row.finding, 'not-assessed-identity-conflict');
  assert.equal(row.pointer_url, '');
  assert.equal(row.mrf_url, '');
  assert.equal(view.history['244015'].domain, 'ecommunity.com');
  const nationwide = require(path.join(audit, 'nationwide-verification.json')).records.find(item => item.ccn === '244015');
  assert.equal(nationwide.official_domain, 'mn.gov');
  assert.equal(nationwide.mrf_url, '');
  const reconciled = require(path.join(audit, 'nationwide-reconciliation.json')).records.find(item => item.ccn === '244015');
  assert.equal(reconciled.workstream, 'identity-quarantine');
  assert.match(reconciled.next_action, /Baxter-specific first-party cms-hpt\.txt or pricing\/file route/i);
});
