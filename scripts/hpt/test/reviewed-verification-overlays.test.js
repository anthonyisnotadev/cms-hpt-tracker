'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { applyReviewedVerificationOverlays } = require('../lib/reviewed-verification-overlays');
const { effectiveDispositionCategory } = require('../build-nationwide-verification');

const root = path.resolve(__dirname, '../../..');
const auditDir = path.join(root, 'data/hpt-audit');
const read = name => JSON.parse(fs.readFileSync(path.join(auditDir, name), 'utf8'));

test('current page-file proof overlays only the exact older TriStar 403 record and preserves raw input', () => {
  const original = read('nationwide-verification.json').records;
  const before = JSON.stringify(original.find(record => record.ccn === '440161'));
  const effective = applyReviewedVerificationOverlays(original, auditDir);
  const raw = original.find(record => record.ccn === '440161');
  const reviewed = effective.find(record => record.ccn === '440161');
  const overlay = read('reconciliation-nationwide-verification-overlays.json').records.find(record => record.ccn === '440161');
  const proof = read('reconciliation-tristar-centennial-current-page-file-promotion-proof-2026-09-26.json');
  const manual = read('reconciliation-manual-access-observations.json').records.find(record => record.ccn === '440161');
  const byteProof = read('nationwide-file-byte-proof.json').records.find(record => record.ccns?.includes('440161')
    && record.url === overlay.page_linked_mrf_url);

  assert.equal(JSON.stringify(raw), before);
  assert.equal(overlay.page_linked_mrf_url, proof.file_url);
  assert.equal(overlay.page_linked_mrf_url, manual.facility_file_url);
  assert.equal(overlay.page_linked_mrf_url, byteProof.url);
  assert.equal(overlay.tracker_link_url, proof.official_pricing_page);
  assert.equal(byteProof.url, overlay.page_linked_mrf_url,
    'the byte sample must be from the exact current page-linked signed file URL');
  assert.notEqual(overlay.page_linked_mrf_url, manual.page_mrf_url,
    'the superseded HCA DAM route must not replace the current signed Azure file link');
  assert.equal(raw.disposition, 'mrf-request-unsuccessful');
  assert.equal(raw.mrf_http_status, '403');
  assert.equal(raw.declared_address, '');
  assert.equal(reviewed.disposition, 'verified-current-mrf');
  assert.equal(reviewed.mrf_url, overlay.tracker_link_url);
  assert.equal(reviewed.disposition, 'verified-current-mrf');
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

test('a later incomplete retry is preserved separately without erasing verified page-file evidence', () => {
  const original = read('nationwide-verification.json').records;
  const changed = original.map(record => record.ccn === '440161'
    ? { ...record, disposition: 'pointer-discovery-incomplete', observed_at: '2026-09-27T00:00:00Z',
      next_action: 'Retry after access route changes.' } : record);
  const reviewed = applyReviewedVerificationOverlays(changed, auditDir).find(record => record.ccn === '440161');
  assert.equal(reviewed.disposition, 'verified-current-mrf');
  assert.equal(reviewed.observed_at, '2026-09-26T06:32:44.210Z');
  assert.equal(reviewed.standing_evidence_retained, true);
  assert.equal(reviewed.observation_role, 'incomplete-retry-standing-retained');
  assert.equal(effectiveDispositionCategory(reviewed), 'standing-evidence-retained');
  assert.deepEqual(reviewed.latest_retry_observation, {
    disposition: 'pointer-discovery-incomplete',
    observed_at: '2026-09-27T00:00:00Z',
    mrf_http_status: '403',
    pointer_state: changed.find(record => record.ccn === '440161').pointer_state || '',
    pointer_result: changed.find(record => record.ccn === '440161').pointer_result || '',
    mrf_url_sha256: crypto.createHash('sha256')
      .update(String(changed.find(record => record.ccn === '440161').mrf_url || '')).digest('hex'),
    next_action: 'Retry after access route changes.'
  });
});

test('a later changed verified result is not overwritten by a stale reviewed overlay', () => {
  const original = read('nationwide-verification.json').records;
  const changed = original.map(record => record.ccn === '440161'
    ? { ...record, disposition: 'verified-stale-mrf', observed_at: '2026-09-27T00:00:00Z' } : record);
  assert.throws(() => applyReviewedVerificationOverlays(changed, auditDir),
    /base observation changed/);
});
