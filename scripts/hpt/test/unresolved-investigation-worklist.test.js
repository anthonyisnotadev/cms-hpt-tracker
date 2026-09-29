'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build } = require('../build-unresolved-investigation-worklist');

const audit = path.resolve(__dirname, '../../../data/hpt-audit');
const read = name => fs.readFileSync(path.join(audit, name));

test('unresolved investigation worklist covers each live CCN with a specific evidence gate', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const verification = JSON.parse(read('nationwide-verification.json'));
  const saved = JSON.parse(read('unresolved-investigation-worklist.json'));
  const fresh = build(reconciliation, verification);
  assert.deepEqual(saved.summary, fresh.summary);
  assert.deepEqual(saved.records, fresh.records);
  assert.equal(saved.records.length, reconciliation.records.filter(row =>
    row.workstream === 'genuinely-unresolved-investigation'
      && !String(verification.records.find(item => item.ccn === row.ccn)?.disposition || '').startsWith('scope-exempt')).length);
  assert.ok(!saved.records.some(row => row.ccn === '021309'), 'reviewed scope-exempt CCNs are excluded from the unresolved action queue');
  assert.ok(!saved.records.some(row => row.ccn === '370171'), 'reviewed scope-exempt CCNs are excluded from the unresolved action queue');
  assert.equal(new Set(saved.records.map(row => row.ccn)).size, saved.records.length);
  assert.equal(Object.values(saved.summary.by_tier).reduce((sum, count) => sum + count, 0), saved.records.length);
  assert.ok(saved.records.every(row => row.evidence_gate && row.next_action && row.next_action.length > 20));
  assert.ok(saved.records.every(row => typeof row.candidate_file_recorded === 'boolean'));
  assert.equal(saved.records.find(row => row.ccn === '190241').candidate_file_recorded, true);
  const parkCenter = saved.records.find(row => row.ccn === '154060');
  const parkCenterEvidence = JSON.parse(read('reconciliation-manual-access-observations.json'))
    .records.find(row => row.ccn === '154060');
  assert.equal(parkCenter.current_disposition, 'pointer-facility-match-unresolved');
  assert.deepEqual(parkCenter.reviewed_sources, ['manual-access']);
  assert.equal(parkCenter.candidate_file_recorded, false);
  assert.equal(parkCenterEvidence.pointer_location_names.length, 11);
  assert.ok(parkCenterEvidence.pointer_location_names.every(name => !/Park Center/i.test(name)));
  assert.match(parkCenter.next_action, /do not borrow any of the 11 other Parkview location files/);
  const lifebrite = saved.records.find(row => row.ccn === '111314');
  const lifebriteEvidence = JSON.parse(read('reconciliation-manual-access-observations.json'))
    .records.find(row => row.ccn === '111314');
  const lifebritePageReview = JSON.parse(read('reconciliation-lifebrite-early-live-pricing-page-review-2026-09-28.json'));
  assert.equal(lifebrite.current_disposition, 'pointer-facility-match-unresolved');
  assert.equal(lifebrite.latest_review_at, lifebritePageReview.observed_at);
  assert.match(lifebriteEvidence.latest_live_pricing_page_review_2026_09_28.pricing_scope, /does not account for insurance-negotiated rates/);
  assert.equal(lifebriteEvidence.latest_live_pricing_page_review_2026_09_28.link_target, lifebritePageReview.live_page_observations.download_link_target);
  assert.match(lifebrite.next_action, /Do not repeat retrieval or format analysis of the same unchanged XLSX/);
  assert.match(lifebrite.next_action, /corrected current pointer\/file or publisher-provided CMS-format MRF/);
  const griffin = saved.records.find(row => row.ccn === '070031');
  const griffinEvidence = JSON.parse(read('reconciliation-manual-access-observations.json'))
    .records.find(row => row.ccn === '070031');
  const griffinPortalReview = JSON.parse(read('reconciliation-griffin-negotiated-rates-portal-terms-review-2026-09-28.json'));
  assert.equal(griffin.current_disposition, 'file-custom-workbook-review');
  assert.equal(griffin.latest_review_at, griffinPortalReview.observed_at);
  assert.equal(griffinEvidence.latest_negotiated_rates_portal_terms_review_2026_09_28.proof_file,
    'reconciliation-griffin-negotiated-rates-portal-terms-review-2026-09-28.json');
  assert.match(griffin.next_action, /Only after user authorization to accept the vendor terms/);
  assert.match(griffin.next_action, /inspect whether the portal exposes a direct machine-readable negotiated-rates file/);
  assert.ok(!/https?:\/\//i.test(JSON.stringify(saved.records)));
  for (const name of ['nationwide-reconciliation.json', 'nationwide-verification.json',
    'reconciliation-independence-health-access-proof.json',
    'reconciliation-coal-county-page-file-proof.json',
    'reconciliation-reedsburg-pointer-case-proof.json',
    'reconciliation-houston-county-address-conflict-proof.json',
    'reconciliation-creekhealth-sibling-exclusion-proof.json',
    'reconciliation-grand-view-page-file-lead-proof.json',
    'reconciliation-avera-three-site-access-proof.json',
    'reconciliation-summit-casper-site-proof.json',
    'reconciliation-roosevelt-general-current-pricing-route-review-2026-09-27.json',
    'reconciliation-carrus-lakeside-successor-pricing-scope-review-2026-09-27.json',
    'reconciliation-alaska-psychiatric-institute-state-scope-review-2026-09-27.json',
    'reconciliation-howard-university-third-party-exact-file-lead-2026-09-27.json',
    'reconciliation-howard-university-downloaded-file-review-2026-09-27.json',
    'reconciliation-minidoka-procedureradar-current-mrf-link-conflict-2026-09-27.json',
    'reconciliation-lifebrite-early-live-pricing-page-review-2026-09-28.json',
    'reconciliation-griffin-negotiated-rates-portal-terms-review-2026-09-28.json',
    'reconciliation-rolling-hills-tennessee-domain-lead-2026-09-28.json']) {
    assert.equal(saved.source_sha256[name], crypto.createHash('sha256').update(read(name)).digest('hex'));
  }
});

test('manual rechecks cannot hide behind an older top-level observation timestamp', () => {
  const manual = JSON.parse(read('reconciliation-manual-access-observations.json'));
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const verification = JSON.parse(read('nationwide-verification.json'));
  const worklist = new Map(build(reconciliation, verification).records.map(row => [row.ccn, row]));
  const collectDates = (value, out = []) => {
    if (!value || typeof value !== 'object') return out;
    if (Array.isArray(value)) {
      value.forEach(item => collectDates(item, out));
      return out;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested === 'string' && /(observed|reviewed|checked|updated|retrieved|recheck|at$)/i.test(key)
        && /^\d{4}-\d\d-\d\dT/.test(nested)) out.push(nested);
      else if (nested && typeof nested === 'object') collectDates(nested, out);
    }
    return out;
  };
  const violations = [];
  for (const record of manual.records) {
    if (!worklist.has(record.ccn)) continue;
    const nested = collectDates(record).map(Date.parse).filter(Number.isFinite);
    const latest = Math.max(...nested);
    const queued = Date.parse(worklist.get(record.ccn)?.latest_review_at || '');
    if (Number.isFinite(latest) && (!Number.isFinite(queued) || queued < latest)) {
      violations.push(record.ccn);
    }
  }
  assert.deepEqual(violations, []);
});

test('newest nested manual recheck controls action without erasing older pointer evidence', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const row = reconciliation.records.find(record => record.ccn === '360025');
  assert.equal(row.latest_observed_at, '2026-09-27T22:42:00Z');
  assert.equal(row.manual_access_observation.latest_recheck_2026_09_27.page_file_status, 403);
  assert.equal(row.manual_access_observation.latest_recheck_action_observed_at, '2026-09-27T22:42:00Z');
  assert.match(row.manual_access_observation.next_action, /Do not repeat the same blocked clients/);
  assert.equal(row.manual_access_observation.latest_recheck_2026_09_25.direct_response_sha256,
    '774303f06088855d3d2f15be04c82d01f84714157e85c33849277d30c6eb0d71');
});

test('Roosevelt current broken price route stays distinct from its historical charge-master PDF', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const record = reconciliation.records.find(item => item.ccn === '320084');
  const route = JSON.parse(read('reconciliation-roosevelt-general-current-pricing-route-review-2026-09-27.json'));
  const queued = build(reconciliation, JSON.parse(read('nationwide-verification.json'))).records
    .find(item => item.ccn === '320084');
  assert.equal(route.ccn, '320084');
  assert.equal(route.current_hospital_charges_route_web_reader_result, '404 Not Found');
  assert.equal(route.mrf_bytes_retrieved, false);
  assert.equal(record.latest_observed_at, route.observed_at);
  assert.equal(record.manual_access_observation.facility_file_url,
    'https://www.myrgh.org/images/CDM-Price-Update-eff-07-01-2025-Website.pdf');
  assert.match(record.next_action, /preserve the July 2025 PDF only as a charge-master lead/);
  assert.equal(queued.current_disposition, 'file-custom-workbook-review');
  assert.equal(queued.latest_review_at, route.observed_at);
  assert.match(queued.next_action, /Do not repeat these same blocked URLs/);
});

test('Carrus Lakeside successor pricing links do not establish a Bristow CCN mapping', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const verification = JSON.parse(read('nationwide-verification.json'));
  const proof = JSON.parse(read('reconciliation-carrus-lakeside-successor-pricing-scope-review-2026-09-27.json'));
  const record = reconciliation.records.find(item => item.ccn === '370246');
  const queued = build(reconciliation, verification).records.find(item => item.ccn === '370246');
  assert.equal(proof.pricing_page_file_links.length, 5);
  assert.ok(proof.pricing_page_file_links.every(file => file.head_status === 200 && file.content_type === 'application/json'));
  assert.ok(proof.pricing_page_file_links.every(file => !file.linked_filename.startsWith('370246_')));
  assert.equal(proof.file_bodies_retrieved, false);
  assert.equal(record.latest_observed_at, proof.observed_at);
  assert.equal(record.manual_access_observation.latest_pricing_scope_review_2026_09_27.ccn_370246_mapping_found, false);
  assert.equal(queued.current_disposition, 'pointer-facility-match-unresolved');
  assert.match(queued.next_action, /Do not infer coverage from shared ownership/);
});

test('Alaska Psychiatric Institute state ownership alone does not create a scope exemption', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const verification = JSON.parse(read('nationwide-verification.json'));
  const proof = JSON.parse(read('reconciliation-alaska-psychiatric-institute-state-scope-review-2026-09-27.json'));
  const record = reconciliation.records.find(item => item.ccn === '024002');
  const queued = build(reconciliation, verification).records.find(item => item.ccn === '024002');
  assert.match(proof.cms_guidance_observation, /state-owned\/operated facilities/);
  assert.match(proof.cms_guidance_observation, /exclusively to individuals in the custody of penal authorities/);
  assert.match(proof.official_admission_scope, /voluntarily or involuntarily/);
  assert.equal(proof.mrf_bytes_retrieved, false);
  assert.equal(proof.disposition, 'pointer-not-retrieved');
  assert.equal(record.latest_observed_at, proof.observed_at);
  assert.equal(queued.current_disposition, 'pointer-not-retrieved');
  assert.match(queued.next_action, /Keep API in the ordinary in-scope MRF assessment/);
  assert.match(queued.next_action, /do not treat the 2025 Facility Rates PDF as an MRF/);
});

test('South Oaks third-party raw-file link conflicts with Zucker Hillside filename and stays unresolved', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const verification = JSON.parse(read('nationwide-verification.json'));
  const proof = JSON.parse(read('reconciliation-south-oaks-third-party-file-conflict-review-2026-09-27.json'));
  const publisherProof = JSON.parse(read('reconciliation-south-oaks-publisher-mrf-development-status-2026-09-28.json'));
  const record = reconciliation.records.find(item => item.ccn === '334027');
  const queued = build(reconciliation, verification).records.find(item => item.ccn === '334027');
  assert.match(proof.third_party_lead.linked_file_url, /Zucker_Hillside_Hospital_Hospital_StandardCharges\.zip$/);
  assert.equal(proof.official_identity.finding.includes('no South Oaks-specific entry'), true);
  assert.equal(proof.third_party_lead.limitation.includes('No archive bytes'), true);
  assert.equal(proof.disposition, 'pointer-facility-match-unresolved');
  assert.equal(publisherProof.official_price_transparency_page.observation.includes('file for South Oaks is in development'), true);
  assert.equal(publisherProof.official_campus_root_pointer_recheck.south_oaks_entry_observed, false);
  assert.equal(record.latest_observed_at, publisherProof.observed_at);
  assert.equal(record.manual_access_observation.publisher_status_recheck_2026_09_28.proof_file,
    'reconciliation-south-oaks-publisher-mrf-development-status-2026-09-28.json');
  assert.equal(queued.current_disposition, 'pointer-facility-match-unresolved');
  assert.match(queued.next_action, /Do not repeat the unchanged generic pointer/);
  assert.match(queued.next_action, /only after a publisher source or page-content change/);
});

test('Howard University complete publisher-hosted file stays unattributed due MD/DC scope conflict', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const verification = JSON.parse(read('nationwide-verification.json'));
  const proof = JSON.parse(read('reconciliation-howard-university-third-party-exact-file-lead-2026-09-27.json'));
  const fileReview = JSON.parse(read('reconciliation-howard-university-downloaded-file-review-2026-09-27.json'));
  const record = reconciliation.records.find(item => item.ccn === '090003');
  const queued = build(reconciliation, verification).records.find(item => item.ccn === '090003');
  assert.match(proof.third_party_page.raw_file_url, /^https:\/\/huhealthcare\.com\/app\/files\/public\//);
  assert.equal(proof.bounded_requests[0].http_status, 403);
  assert.equal(proof.bounded_requests[1].http_status, 403);
  assert.equal(proof.bounded_requests[1].response_bytes, 529);
  assert.equal(proof.complete_browser_download_review.complete_file_downloaded, true);
  assert.equal(fileReview.file_integrity.bytes, 18190345);
  assert.equal(fileReview.file_integrity.pricing_rows, 109782);
  assert.equal(fileReview.file_integrity.data_rows_with_wrong_column_count, 0);
  assert.equal(fileReview.observed_metadata.license_header, 'license_number|MD');
  assert.equal(fileReview.observed_metadata.maryland_rate_setting_narrative_present, true);
  assert.equal(fileReview.validation.official_cms_pointer_mapping_obtained, false);
  assert.match(proof.disposition_effect, /No CCN attribution or verification promotion/);
  assert.equal(record.latest_observed_at, proof.observed_at);
  assert.equal(record.manual_access_observation.latest_exact_third_party_file_lead_2026_09_27.file_bytes_retrieved, true);
  assert.match(record.manual_access_observation.latest_exact_third_party_file_lead_2026_09_27.result, /material scope conflict/);
  assert.equal(queued.current_disposition, 'pointer-not-retrieved');
  assert.match(queued.next_action, /Do not retry unchanged blocked routes/);
});

test('Grand View and Avera source reviews narrow four gates without overstating file verification', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const verification = JSON.parse(read('nationwide-verification.json'));
  const rows = new Map(build(reconciliation, verification).records.map(row => [row.ccn, row]));
  const grandView = rows.get('390057');
  assert.equal(grandView, undefined);
  const standing = JSON.parse(read('standing-evidence-followup-worklist.json'));
  const grandViewStanding = standing.records.find(row => row.ccn === '390057');
  assert.equal(grandViewStanding.standing_finding, 'root-pointer-omits-facility-page-file-found');
  assert.equal(grandViewStanding.current_disposition, 'pointer-facility-match-unresolved');
  assert.equal(grandViewStanding.reviewed_follow_up, true);
  assert.match(grandViewStanding.next_action, /recheck complete-file usability/);
  for (const ccn of ['431308', '431313', '431318']) {
    const row = rows.get(ccn);
    assert.equal(row.current_disposition, 'first-party-labeled-file-client-access-denied');
    assert.equal(row.nationwide_disposition, 'pointer-facility-match-unresolved');
    assert.equal(row.evidence_gate, 'exact-file-access-and-campus-attribution');
    assert.deepEqual(row.reviewed_sources, ['manual-access', 'avera-access-proof']);
    assert.equal(row.candidate_file_recorded, true);
    assert.match(row.next_action, /Do not repeat the denied browser request/);
  }
  assert.match(rows.get('431308').next_action, /202 J Ave nursing site against the 200 J Ave hospital/);
  const changed = structuredClone(verification);
  changed.records.find(row => row.ccn === '390057').pointer_corpus_sha256 = 'changed';
  changed.records.find(row => row.ccn === '431308').pointer_corpus_sha256 = 'changed';
  const staleRows = new Map(build(reconciliation, changed).records.map(row => [row.ccn, row]));
  assert.equal(staleRows.get('390057'), undefined);
  assert.equal(staleRows.get('431308').current_disposition, 'pointer-facility-match-unresolved');
});

test('Independence Health access review narrows remaining unresolved gates without promoting a file', () => {
  const reconciliation = JSON.parse(read('nationwide-reconciliation.json'));
  const verification = JSON.parse(read('nationwide-verification.json'));
  const rows = new Map(build(reconciliation, verification).records.map(row => [row.ccn, row]));
  // Clarion (390093) and Latrobe (390219) now have separately reviewed
  // complete page-linked files; only Butler Memorial remains access-gated.
  assert.equal(rows.get('390093'), undefined);
  assert.equal(rows.get('390219'), undefined);
  for (const ccn of ['390168']) {
    const row = rows.get(ccn);
    assert.equal(row.current_disposition, 'first-party-labeled-file-client-access-denied');
    assert.equal(row.nationwide_disposition, 'pointer-facility-match-unresolved');
    assert.deepEqual(row.reviewed_sources, ['manual-access', 'independence-access-proof']);
    assert.equal(row.candidate_file_recorded, true);
    assert.match(row.next_action, /byte-backed header/);
  }
  assert.equal(rows.get('390168').evidence_gate, 'file-access-and-url-equivalence');
  const tampered = structuredClone(verification);
  tampered.records.find(row => row.ccn === '390168').pointer_corpus_sha256 = 'changed';
  assert.equal(build(reconciliation, tampered).records.find(row => row.ccn === '390168').current_disposition,
    'pointer-facility-match-unresolved');
});

test('reviewed cases remain actionable but sort behind untouched cases within their tier', () => {
  const reconciliation = {
    records: [
      { ccn: '000002', hospital_name: 'B', state: 'AA', workstream: 'genuinely-unresolved-investigation',
        proposed_disposition: 'mrf-request-unsuccessful', next_action: 'Retry the exact file.',
        manual_access_observation: { observed_at: '2026-09-16T00:00:00Z', next_action: 'Wait for a changed publisher file.' } },
      { ccn: '000003', hospital_name: 'C', state: 'AA', workstream: 'genuinely-unresolved-investigation',
        proposed_disposition: 'mrf-request-unsuccessful', next_action: 'Try the current exact file.' },
      { ccn: '000001', hospital_name: 'A', state: 'AA', workstream: 'genuinely-unresolved-investigation',
        proposed_disposition: 'mrf-request-unsuccessful',
        reviewed_header_disposition: { next_action: 'Wait for a corrected publisher version.' },
        next_action: 'Wait for a corrected publisher version.' },
    ],
  };
  const verification = { records: [{ ccn: '000002', official_domain: 'example.org' },
    { ccn: '000003', official_domain: 'example.net' },
    { ccn: '000001', official_domain: 'example.com' }] };
  const rows = build(reconciliation, verification).records;
  assert.deepEqual(rows.map(row => row.ccn), ['000003', '000001', '000002']);
  assert.deepEqual(rows[1].reviewed_sources, ['reviewed-header']);
  assert.equal(rows[2].next_action, 'Wait for a changed publisher file.');
});

test('a documented browser HTTP denial replaces an identical browser retry, not a reviewed action', () => {
  const reconciliation = { records: [
    { ccn: '000001', hospital_name: 'A', state: 'NY', workstream: 'genuinely-unresolved-investigation',
      proposed_disposition: 'mrf-request-unsuccessful',
      next_action: 'Retry the exact pointer-declared MRF in a browser/download-capable client.' },
    { ccn: '000002', hospital_name: 'B', state: 'NY', workstream: 'genuinely-unresolved-investigation',
      proposed_disposition: 'mrf-request-unsuccessful',
      next_action: 'Retry the exact pointer-declared MRF in a browser/download-capable client.',
      manual_access_observation: { observed_at: '2026-09-16T00:00:00Z', next_action: 'Use a specific reviewed recovery route.' } },
  ] };
  const verification = { records: [
    { ccn: '000001', browser_mrf_status: 'http-denied', browser_mrf_observed_at: '2026-09-15T00:00:00Z' },
    { ccn: '000002', browser_mrf_status: 'http-denied', browser_mrf_observed_at: '2026-09-15T00:00:00Z' },
  ] };
  const byCcn = new Map(build(reconciliation, verification).records.map(row => [row.ccn, row]));
  assert.match(byCcn.get('000001').next_action, /browser already observed HTTP denial/);
  assert.match(byCcn.get('000001').next_action, /publisher-corrected pointer/);
  assert.equal(byCcn.get('000001').last_browser_file_observed_at, '2026-09-15T00:00:00Z');
  assert.equal(byCcn.get('000002').next_action, 'Use a specific reviewed recovery route.');
});
