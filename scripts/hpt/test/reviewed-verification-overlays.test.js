'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { applyReviewedVerificationOverlays } = require('../lib/reviewed-verification-overlays');

const root = path.resolve(__dirname, '../../..');
const auditDir = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(auditDir, name), 'utf8'));

test('current page-file proof overlays only the exact older TriStar 403 record and preserves raw input', () => {
  const original = read('nationwide-verification.json').records;
  const before = JSON.stringify(original.find(record => record.ccn === '440161'));
  const effective = applyReviewedVerificationOverlays(original, auditDir);
  const raw = original.find(record => record.ccn === '440161');
  const reviewed = effective.find(record => record.ccn === '440161');

  assert.equal(JSON.stringify(raw), before);
  assert.equal(raw.mrf_http_status, '403');
  assert.equal(raw.declared_address, '');
  assert.equal(reviewed.disposition, 'verified-current-mrf');
  assert.equal(reviewed.mrf_url,
    'https://hcadam.com/api/public/content/0947329859ac44d4aee0f06e1cda2eb9?download=true');
  assert.equal(reviewed.mrf_state, 'verified-current-v3');
  assert.equal(reviewed.mrf_http_status, '206');
  assert.equal(reviewed.facility_identity, 'corroborated-by-reviewed-browser-read');
  assert.equal(reviewed.declared_hospital_name, 'TRISTAR CENTENNIAL MEDICAL CENTER');
  assert.match(reviewed.declared_address, /2300 PATTERSON ST\., NASHVILLE, TN, 37203/);
  assert.equal(reviewed.declared_license_state, 'TN');
  assert.equal(reviewed.declared_last_updated, '2026-09-01');
  assert.equal(reviewed.cms_template_version, '3.0.0');
  assert.equal(reviewed.observed_at, '2026-09-26T06:32:44.210Z');
  assert.equal(reviewed.pointer_result, 'http-not-found');
  assert.doesNotMatch(reviewed.mrf_url, /[?&](?:sig|se)=/i);
});

test('a later or otherwise changed raw row is not overwritten by a stale reviewed overlay', () => {
  const original = read('nationwide-verification.json').records;
  const changed = original.map(record => record.ccn === '440161'
    ? { ...record, observed_at: '2026-09-27T00:00:00Z' } : record);
  assert.throws(() => applyReviewedVerificationOverlays(changed, auditDir),
    /base observation changed/);
});
