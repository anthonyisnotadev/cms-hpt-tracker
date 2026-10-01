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

test('later Maniilaq browser bytes and reviewed mailing-to-physical address evidence supersede an older pending retry', () => {
  const original = read('nationwide-verification.json').records;
  const before = JSON.stringify(original.find(record => record.ccn === '021310'));
  const raw = original.find(record => record.ccn === '021310');
  const proof = read('reconciliation-maniilaq-browser-byte-identity-proof-2026-09-17.json');
  const effective = applyReviewedVerificationOverlays(original, auditDir).find(record => record.ccn === '021310');

  assert.equal(JSON.stringify(raw), before, 'the source observation remains immutable');
  assert.equal(proof.later_exact_url_browser_byte_proof.sha256,
    '7abd738fb5264df4a2b97836050b5fb60d567bee0eefeb9f5f04bcdd09b960f7');
  assert.equal(raw.disposition, 'mrf-verification-pending');
  assert.equal(raw.observed_at, '2026-09-15T19:59:31.293Z');
  assert.equal(effective.disposition, 'verified-current-mrf');
  assert.equal(effective.mrf_state, 'verified-current-v3');
  assert.equal(effective.facility_identity, 'corroborated-by-reviewed-browser-read');
  assert.equal(effective.browser_identity_gate, 'reviewed-file-address-equivalence');
  assert.equal(effective.cms_template_version, '3.0.0');
  assert.equal(effective.declared_last_updated, '2026-07-16');
  assert.equal(effective.observed_at, '2026-09-17T22:46:18.139Z');
  assert.equal(effective.address_reconciliation.roster_address, 'PO BOX 43');
  assert.equal(effective.address_reconciliation.file_address, '436 5th Ave Kotzebue AK 99752');
  assert.equal(effective.latest_retry_observation.disposition, 'mrf-verification-pending');
  assert.equal(effective.latest_retry_observation.observed_at, raw.observed_at);
  assert.equal(effective.latest_retry_observation.superseded_by_reviewed_pointer_file_identity, true);
  assert.equal(effective.latest_observation_superseded, false);
  assert.equal(effective.standing_evidence_retained, false);
  assert.equal(effectiveDispositionCategory(effective), 'active-verification-claim');
  assert.equal(effective.standing_evidence_retained, false);
});

test('fresh hash-matched Sutter pointer and bounded Mills-Peninsula header supersede the misattributed generic retry', () => {
  const original = read('nationwide-verification.json').records;
  const raw = original.find(record => record.ccn === '050007');
  const before = JSON.stringify(raw);
  const effective = applyReviewedVerificationOverlays(original, auditDir).find(record => record.ccn === '050007');
  const proof = read('reconciliation-sutter-050007-current-pointer-proof-2026-09-26.json');

  assert.equal(JSON.stringify(raw), before, 'the raw nationwide retry remains immutable');
  assert.equal(raw.disposition, 'pointer-facility-match-unresolved');
  assert.equal(effective.disposition, 'verified-current-mrf');
  assert.equal(effective.mrf_state, 'verified-current-v3');
  assert.equal(effective.observed_at, '2026-09-30T12:18:27Z');
  assert.equal(effective.pointer_state, 'retrieved-facility-match');
  assert.equal(effective.facility_identity, 'corroborated');
  assert.equal(effective.declared_hospital_name, 'Mills-Peninsula Medical Center');
  assert.equal(effective.declared_address, '1501 Trousdale Drive, Burlingame, CA 94010');
  assert.equal(effective.cms_template_version, '3.0.0');
  assert.equal(effective.latest_observation_superseded, false);
  assert.equal(effective.standing_evidence_retained, false);
  assert.equal(effective.latest_retry_observation.disposition, 'pointer-facility-match-unresolved');
  assert.equal(effective.evidence.reviewed_current_pointer_file_identity.source_proof_file,
    'reconciliation-sutter-050007-current-pointer-proof-2026-09-26.json');
  assert.equal(effective.evidence.reviewed_current_pointer_file_identity.cms_template_version, '3.0.0');
  assert.equal(effective.evidence.reviewed_current_pointer_file_identity.declared_hospital_name, 'Mills-Peninsula Medical Center');
  assert.equal(effective.evidence.reviewed_current_pointer_file_identity.declared_address, '1501 Trousdale Drive, Burlingame, CA 94010');
  assert.equal(effective.latest_retry_observation.superseded_by_reviewed_current_pointer_file_identity, true);
  assert.equal(effectiveDispositionCategory(effective), 'active-verification-claim');
});

test('Trinity operator-alias pointer and complete CMS 3.0.0 file reconcile the exact unresolved CCN', () => {
  const original = read('nationwide-verification.json').records;
  const raw = original.find(record => record.ccn === '051315');
  const before = JSON.stringify(raw);
  const effective = applyReviewedVerificationOverlays(original, auditDir).find(record => record.ccn === '051315');
  const proof = read('reconciliation-trinity-hospital-ccn-051315-pointer-alias-full-file-proof-2026-09-30.json');

  assert.equal(JSON.stringify(raw), before, 'the September 15 unresolved source observation remains unchanged');
  assert.equal(raw.disposition, 'pointer-facility-match-unresolved');
  assert.equal(effective.disposition, 'verified-current-mrf');
  assert.equal(effective.observed_at, proof.latest_live_recheck_2026_09_30.observed_at);
  assert.equal(effective.mrf_url, proof.mrf.url);
  assert.equal(effective.mrf_http_status, '200');
  assert.equal(effective.pointer_state, 'retrieved-facility-match');
  assert.equal(effective.pointer_corpus_sha256, proof.sources.official_current_root_pointer.sha256);
  assert.equal(effective.facility_identity, 'corroborated');
  assert.equal(effective.declared_hospital_name, 'MOUNTAIN COMMUNTIES HEALTHCARE DISTRICT',
    'preserve the literal header misspelling');
  assert.equal(effective.declared_location_name, 'MOUNTAIN COMMUNITIES HEALTHCARE DISTRICT');
  assert.equal(effective.declared_address, proof.mrf.declared_address);
  assert.equal(effective.declared_license_state, 'CA');
  assert.equal(effective.declared_last_updated, '2026-03-30');
  assert.equal(effective.cms_template_version, '3.0.0');
  assert.equal(effective.latest_retry_observation.disposition, 'pointer-facility-match-unresolved');
  assert.equal(effective.latest_retry_observation.superseded_by_reviewed_operator_alias_pointer_file_identity, true);
  assert.equal(effective.latest_observation_superseded, false);
  assert.equal(effective.standing_evidence_retained, false);
  assert.equal(effectiveDispositionCategory(effective), 'active-verification-claim');
  assert.equal(effective.evidence.reviewed_operator_alias_pointer_file_identity.file_sha256,
    proof.mrf.complete_sha256);
  assert.equal(effective.evidence.reviewed_operator_alias_pointer_file_identity.parsed_data_rows, 8701);
  assert.match(effective.next_action, /not a legal-compliance or line-item conclusion/);

  const reconciliation = read('nationwide-reconciliation.json').records.find(row => row.ccn === '051315');
  const worklist = read('unresolved-investigation-worklist.json');
  assert.equal(reconciliation.proposed_disposition, 'verified-current-mrf');
  assert.equal(reconciliation.workstream, 'consistent');
  assert.ok(!reconciliation.issues.includes('verification-file-byte-proof-audit-pending'));
  assert.ok(!reconciliation.issues.includes('browser-file-identity-proof-insufficient'));
  assert.ok(!worklist.records.some(row => row.ccn === '051315'));
});

test('Trinity operator-alias evidence cannot replace a changed base observation', () => {
  const original = read('nationwide-verification.json').records;
  const changed = original.map(record => record.ccn === '051315'
    ? { ...record, pointer_state: 'pointer-access-denied' } : record);
  assert.throws(() => applyReviewedVerificationOverlays(changed, auditDir), /base observation changed/);
});

test('Sutter current-pointer identity overlay refuses a changed base retry', () => {
  const original = read('nationwide-verification.json').records;
  const changed = original.map(record => record.ccn === '050007'
    ? { ...record, mrf_http_status: '404' } : record);
  assert.throws(() => applyReviewedVerificationOverlays(changed, auditDir), /base observation changed/);
});

test('Maniilaq review will not override a changed URL, header, or base observation', () => {
  const original = read('nationwide-verification.json').records;
  const changed = original.map(record => record.ccn === '021310'
    ? { ...record, cms_template_version: '2.0.0' } : record);
  assert.throws(() => applyReviewedVerificationOverlays(changed, auditDir),
    /base observation changed/);
});
