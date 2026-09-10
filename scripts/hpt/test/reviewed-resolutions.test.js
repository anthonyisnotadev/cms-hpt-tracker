'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyResolutions } = require('../lib/reviewed-resolutions');
const base = { ccn: '010001', finding: 'mrf-url-unreachable', domain: 'hospital.test', pointer_url: 'https://hospital.test/cms-hpt.txt', mrf_url: 'https://hospital.test/old.csv', checked_at: '2026-09-07T00:00:00Z' };
const resolution = { ccn: base.ccn, base, action: 'replace', note: 'Reviewed', evidence: {
  identity: 'corroborated', pointerUrl: base.pointer_url, pointerSha256: 'verified-body-hash', url: 'https://hospital.test/new.csv',
  http_status: 206, date: '2026-09-01', version: '3.0.0', checked_at: '2026-09-09T00:00:00Z'
} };
test('reviewed replacement updates the view while preserving original evidence', () => {
  const result = applyResolutions([base], [base], [{ ccn: base.ccn }], [resolution]);
  assert.equal(result.compliance[0].mrf_url, resolution.evidence.url);
  assert.equal(result.history[base.ccn].mrf_url, base.mrf_url);
  assert.equal(base.finding, 'mrf-url-unreachable');
  assert.equal(result.gaps.length, 0);
});
test('an old resolution cannot override a changed subsequent crawl', () => {
  const newer = { ...base, checked_at: '2026-09-10T00:00:00Z' };
  const result = applyResolutions([newer], [], [], [resolution]);
  assert.deepEqual(result.compliance, [newer]);
  assert.equal(result.applied.length, 0);
});
test('quarantine removes current file links and date while retaining the old event', () => {
  const result = applyResolutions([base], [base], [], [{ ccn: base.ccn, base, action: 'quarantine', reviewed_at: '2026-09-09', note: 'Wrong hospital' }]);
  assert.equal(result.compliance[0].mrf_url, '');
  assert.equal(result.manifest.length, 0);
  assert.equal(result.history[base.ccn].mrf_url, base.mrf_url);
});
test('missing identity or pointer evidence prevents replacement', () => {
  assert.throws(() => applyResolutions([base], [], [], [{ ...resolution, evidence: { ...resolution.evidence, identity: 'review' } }]), /lacks current/);
  assert.throws(() => applyResolutions([base], [], [], [{ ...resolution, evidence: { ...resolution.evidence, pointerUrl: '' } }]), /lacks current/);
});

test('an externally hosted pointer does not replace an explicitly verified hospital domain', () => {
  const r = { ...resolution, evidence: { ...resolution.evidence, pointerUrl: 'https://cdn.example.org/cms-hpt.txt', officialDomain: base.domain } };
  const result = applyResolutions([base], [], [], [r]);
  assert.equal(result.compliance[0].domain, base.domain);
  assert.equal(result.compliance[0].pointer_url, r.evidence.pointerUrl);
});
