'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadReviewedView } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');

test('CHI St. Francis corrects the Breckenridge CCN without importing Allina Shakopee', () => {
  const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
    'reconciliation-chi-st-francis-identity-proof.json'), 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(path.join(audit, 'reviewed-resolutions.json'), 'utf8'));
  const standing = loadReviewedView(audit).compliance.find(item => item.ccn === row.ccn);
  const bytes = fs.readFileSync(path.join(root, row.retained_sample));
  assert.equal(bytes.length, row.retained_bytes);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.mrf_sha256);
  const resolution = ledger.find(item => item.ccn === row.ccn);
  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.evidence.rejectedPointerLocationName, 'St. Francis Regional Medical Center');
  assert.equal(resolution.evidence.rejectedFacilityCity, 'Shakopee');
  assert.equal(resolution.evidence.pointerUrl, row.pointer_url);
  assert.equal(resolution.evidence.url, row.mrf_url);
  assert.equal(standing.finding, 'compliant-observed');
  assert.equal(standing.domain, 'chistfrancishealth.org');
  assert.equal(standing.mrf_url, row.mrf_url);
});
