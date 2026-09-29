'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadReviewedView, applyResolutions } = require('../lib/reviewed-resolutions');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-saint-anthony-chicago-site-proof.json'));
const ledger = require(path.join(audit, 'reviewed-resolutions.json'));

test('Chicago Saint Anthony corrects only its domain and keeps challenged pointer unresolved', () => {
  const resolution = ledger.find(row => row.ccn === '140095');
  assert.equal(resolution.action, 'correct-site');
  assert.equal(resolution.official.domain, 'sahchicago.org');
  assert.equal(resolution.evidence.identityAuthority, 'state-hospital-directory-current');
  assert.equal(resolution.evidence.rootPointerResponseKind, 'html-security-challenge');
  assert.equal(resolution.evidence.rootPointerHttpStatus, 202);
  assert.equal(proof.old_assigned_domain, 'mercy.net');
  const view = loadReviewedView(audit);
  const row = view.compliance.find(item => item.ccn === '140095');
  assert.equal(row.domain, 'sahchicago.org');
  assert.equal(row.finding, 'not-assessed-site-corrected');
  assert.equal(row.pointer_url, '');
  assert.equal(row.mrf_url, '');
  assert.equal(view.history['140095'].domain, 'mercy.net');
  const nationwide = require(path.join(audit, 'nationwide-verification.json')).records.find(item => item.ccn === '140095');
  assert.equal(nationwide.official_domain, 'sahchicago.org');
  assert.equal(nationwide.mrf_url, '');
  assert.match(nationwide.next_action, /security challenge/);
});

test('a 202 response without a proven security challenge cannot justify site correction', () => {
  const resolution = ledger.find(row => row.ccn === '140095');
  assert.throws(() => applyResolutions([resolution.base], [], [], [{ ...resolution,
    evidence: { ...resolution.evidence, rootPointerChallengeMarker: '' } }]));
});
