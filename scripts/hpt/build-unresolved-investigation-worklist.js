'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const reconciliationPath = path.join(audit, 'nationwide-reconciliation.json');
const verificationPath = path.join(audit, 'nationwide-verification.json');
const outputPath = path.join(audit, 'unresolved-investigation-worklist.json');
const reviewedResolutionsPath = path.join(audit, 'reviewed-resolutions.json');
const reviewedResolutions = JSON.parse(fs.readFileSync(reviewedResolutionsPath, 'utf8'));
const stateScopeReviews = new Map(reviewedResolutions
  .filter(record => record.action === 'scope-review-pending')
  .map(record => [record.ccn, record]));
const parkviewProof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-parkview-medical-center-pointer-page-proof.json'), 'utf8'));
const surgicalOklahomaProof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-surgical-oklahoma-pointer-file-proof.json'), 'utf8'));
const groverDilsProof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-grover-dils-source-review.json'), 'utf8'));
const atlanticareCityProof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-atlanticare-city-pointer-proof.json'), 'utf8'));
const independenceProofPath = path.join(audit, 'reconciliation-independence-health-access-proof.json');
const independenceProof = JSON.parse(fs.readFileSync(independenceProofPath, 'utf8'));
const independenceByCcn = new Map(independenceProof.facilities.map(facility => [facility.ccn, facility]));
const coalCountyProof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-coal-county-page-file-proof.json'), 'utf8'));
const reedsburgProof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-reedsburg-pointer-case-proof.json'), 'utf8'));
const houstonCountyProof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-houston-county-address-conflict-proof.json'), 'utf8'));
const creekhealthProof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-creekhealth-sibling-exclusion-proof.json'), 'utf8'));
const creekhealthFullProof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-creekhealth-okmulgee-full-file-proof-2026-09-19.json'), 'utf8'));
const scenicProof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-scenic-mountain-operator-transition-proof.json'), 'utf8'));
const southeasternProof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-unc-southeastern-alias-access-proof.json'), 'utf8'));
const grandViewProofPath = path.join(audit, 'reconciliation-grand-view-page-file-lead-proof.json');
const grandViewProof = JSON.parse(fs.readFileSync(grandViewProofPath, 'utf8'));
const averaProofPath = path.join(audit, 'reconciliation-avera-three-site-access-proof.json');
const averaProof = JSON.parse(fs.readFileSync(averaProofPath, 'utf8'));
const averaByCcn = new Map(averaProof.cases.map(record => [record.ccn, record]));
const summitProofPath = path.join(audit, 'reconciliation-summit-casper-site-proof.json');
const summitProof = JSON.parse(fs.readFileSync(summitProofPath, 'utf8'));
const centraLynchburgProof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-centra-lynchburg-pointer-proof.json'), 'utf8'));
const southOaksProof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-south-oaks-root-pointer-proof.json'), 'utf8'));
const identityRouteProofs = new Map([
  ['370004', 'reconciliation-integris-miami-current-pricing-access-proof-2026-09-20.json'],
  ['400134', 'reconciliation-san-jorge-current-identity-route-proof-2026-09-20.json'],
  ['420020', 'reconciliation-tidelands-georgetown-current-identity-access-proof-2026-09-20.json'],
  ['450144', 'reconciliation-permian-regional-current-identity-route-proof-2026-09-21.json'],
  ['521318', 'reconciliation-ladd-osceola-current-identity-route-proof-2026-09-20.json'],
]);

const isoReviewDate = value => typeof value === 'string'
  && /^\d{4}-\d\d-\d\d(?:T|$)/.test(value) ? value : '';

function latestNestedManualReviewAt(manual) {
  const dates = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (typeof nested === 'string'
        && /(observed|reviewed|checked|updated|retrieved|recheck|at$)/i.test(key)
        && isoReviewDate(nested)) dates.push(nested);
      else if (nested && typeof nested === 'object') visit(nested);
    }
  };
  visit(manual);
  return dates.sort().at(-1) || '';
}

const stages = {
  'mrf-facility-identity-unresolved': {
    tier: 1, gate: 'file-identity',
    action: 'Compare the exact pointer-linked file header with the roster and current first-party facility page; quarantine a sibling or conflicting file.',
  },
  'linked-mrf-header-unmatched': {
    tier: 1, gate: 'file-header',
    action: 'Retain bounded bytes from the exact pointer-declared file and adjudicate its declared hospital, location, address, state, date and version.',
  },
  'pointer-linked-file-not-probed': {
    tier: 1, gate: 'file-header',
    action: 'Retrieve bounded bytes from the exact pointer-declared file, then check facility identity and declared metadata before any verification claim.',
  },
  'pointer-linked-file-review-pending': {
    tier: 2, gate: 'pointer-file-page-reconciliation',
    action: 'Reconcile the reviewed pointer-linked file and current pricing-page download leads, including complete access and declared metadata, before a current-file finding.',
  },
  'file-custom-workbook-review': {
    tier: 2, gate: 'custom-workbook-identity-and-format',
    action: 'Determine whether the official workbook is an exact facility MRF and whether a CMS CSV/JSON replacement exists; do not assign a broader system workbook to this CCN.',
  },
  'mrf-request-unsuccessful': {
    tier: 1, gate: 'file-access',
    action: 'Retry the exact pointer-declared file using a materially different permitted client; preserve transport failure separately from file validity.',
  },
  'pointer-facility-match-unresolved': {
    tier: 2, gate: 'pointer-facility-match',
    action: 'Compare every root-pointer location entry against this CCN and first-party campus name/address; do not assign a shared-system sibling file.',
  },
  'pointer-access-denied-to-client': {
    tier: 3, gate: 'pointer-access',
    action: 'Open the exact official-domain root pointer in a materially different browser/client and record bytes, status and final URL; do not infer absence from access denial.',
  },
  'pointer-not-retrieved': {
    tier: 3, gate: 'pointer-retrieval',
    action: 'Inspect the first-party pricing page and its linked host, then retrieve that host’s root pointer with a bounded client.',
  },
  'pointer-discovery-incomplete': {
    tier: 4, gate: 'pointer-discovery',
    action: 'Confirm the hospital-owned site and pricing page, then test the exact root pointer and any page-linked file; preserve request failures as observations.',
  },
  'official-website-not-identified-completed-search': {
    tier: 5, gate: 'official-site-identity',
    action: 'Resolve the current legal/operator name and first-party site for the roster address before testing any pointer or file.',
  },
  'candidate-website-identity-unverified': {
    tier: 4, gate: 'official-site-identity',
    action: 'Verify the candidate against first-party hospital name and address evidence; only then test its pricing page, root pointer and facility-linked MRF.',
  },
};

function shaFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function build(reconciliation, verification) {
  const byCcn = new Map(verification.records.map(row => [row.ccn, row]));
  // Reconciliation retains source-observation issues even after an exact-CCN
  // reviewed scope disposition. Do not keep scope-exempt facilities in the
  // actionable unresolved queue merely because the raw observation is older.
  const unresolved = reconciliation.records.filter(row => row.workstream === 'genuinely-unresolved-investigation'
    && !String(byCcn.get(row.ccn)?.disposition || '').startsWith('scope-exempt'));
  const records = unresolved.map(row => {
    const current = byCcn.get(row.ccn);
    const stage = stages[row.proposed_disposition];
    if (!current || !stage) throw new Error(`No verification record or stage for ${row.ccn}`);
    const manual = row.manual_access_observation;
    const stateScopeReview = stateScopeReviews.get(row.ccn);
    const scenicTransitionReviewed = row.ccn === scenicProof.ccn
      && row.proposed_disposition === 'pointer-facility-match-unresolved'
      && (manual?.proof_file === 'reconciliation-scenic-mountain-operator-transition-proof.json'
        || manual?.proof_file === 'reconciliation-scenic-mountain-nppes-npi-1497606438-recheck-2026-09-28.json')
      && manual.disposition === scenicProof.disposition
      && Date.parse(manual.observed_at) >= Date.parse(scenicProof.observed_at)
      && manual.pointer_sha256 === scenicProof.current_pointer_sha256
      && manual.pointer_mrf_url === scenicProof.current_pointer_file_url
      && current.pointer_corpus_sha256 === scenicProof.current_pointer_sha256
      && scenicProof.complete_file_validated === false;
    const southeasternAliasReviewed = row.ccn === southeasternProof.ccn
      && row.proposed_disposition === 'pointer-facility-match-unresolved'
      && manual?.proof_file === 'reconciliation-unc-southeastern-alias-access-proof.json'
      && manual.disposition === southeasternProof.disposition
      && manual.observed_at === southeasternProof.observed_at
      && manual.pointer_sha256 === southeasternProof.retained_pointer_sha256
      && manual.pointer_mrf_url_sha256 === southeasternProof.pointer_mrf_url_sha256
      && manual.page_file_url === southeasternProof.official_pricing_page_file_url
      && current.pointer_corpus_sha256 === southeasternProof.retained_pointer_sha256
      && southeasternProof.file_metadata_verified === false;
    const pointerIdentityReviewed = manual?.disposition === 'first-party-pointer-facility-identity-corroborated-file-access-denied-to-client'
      && manual.pointer_sha256 === current.pointer_corpus_sha256
      && manual.pointer_url === current.pointer_corpus_checked_url
      && String(manual.pointer_location_name || '').toUpperCase() === String(row.hospital_name || '').toUpperCase()
      && manual.pointer_file_head_status === 403 && manual.pointer_file_range_status === 403
      && Boolean(manual.proof_file && manual.pointer_file_url);
    const centraLynchburgReviewed = row.ccn === centraLynchburgProof.ccn
      && row.proposed_disposition === 'pointer-facility-match-unresolved'
      && manual?.proof_file === 'reconciliation-centra-lynchburg-pointer-proof.json'
      && manual.disposition === centraLynchburgProof.disposition
      && manual.observed_at === centraLynchburgProof.observed_at
      && manual.pointer_sha256 === centraLynchburgProof.retained_pointer_sha256
      && manual.pointer_url === centraLynchburgProof.retained_pointer_checked_url
      && manual.pointer_location_name === centraLynchburgProof.pointer_location_name
      && manual.pointer_file_url === centraLynchburgProof.pointer_file_url
      && manual.pointer_file_head_status === centraLynchburgProof.pointer_target_head_status
      && current.pointer_corpus_sha256 === centraLynchburgProof.retained_pointer_sha256
      && current.pointer_corpus_final_url === centraLynchburgProof.retained_pointer_final_url
      && shaFile(path.join(root, centraLynchburgProof.retained_pointer_file)) === centraLynchburgProof.retained_pointer_sha256;
    const southOaksPointer = row.ccn === southOaksProof.ccn
      ? fs.readFileSync(path.join(root, southOaksProof.retained_pointer_file), 'utf8') : '';
    const southOaksRootReviewed = row.ccn === southOaksProof.ccn
      && row.proposed_disposition === 'pointer-facility-match-unresolved'
      && manual?.proof_file === 'reconciliation-south-oaks-root-pointer-proof.json'
      && manual.disposition === southOaksProof.disposition
      && manual.observed_at === southOaksProof.observed_at
      && manual.pointer_url === southOaksProof.site_root_pointer_url
      && manual.pointer_sha256 === southOaksProof.site_root_pointer_sha256
      && manual.pointer_location_count === southOaksProof.pointer_location_count
      && manual.facility_entry_present === false
      && current.pointer_corpus_sha256 === southOaksProof.site_root_pointer_sha256
      && shaFile(path.join(root, southOaksProof.retained_pointer_file)) === southOaksProof.site_root_pointer_sha256
      && (southOaksPointer.match(/^location-name:/gm) || []).length === southOaksProof.pointer_location_count
      && !/South Oaks|Amityville|Sunrise Highway/i.test(southOaksPointer);
    const parkviewFileAccessReviewed = manual?.disposition === 'medical-center-pointer-target-404-pricing-page-labels-pueblo-west-file'
      && manual.proof_file === 'reconciliation-parkview-medical-center-pointer-page-proof.json'
      && manual.observed_at === parkviewProof.observed_at
      && manual.retained_pointer_sha256 === parkviewProof.retained_pointer_sha256
      && manual.fresh_pointer_sha256 === parkviewProof.fresh_pointer_sha256
      && manual.fresh_pointer_sha256 === current.pointer_corpus_sha256
      && manual.pointer_medical_center_mrf_url === current.standing_mrf_url
      && manual.pricing_page_both_labels_file_url === current.mrf_url
      && manual.pointer_medical_center_mrf_bounded_get_status === 404
      && manual.pueblo_west_file_declared_location_name === current.declared_location_name
      && manual.pueblo_west_file_declared_address === current.declared_address
      && Boolean(manual.proof_file);
    const surgicalOklahomaHeaderReviewed = manual?.disposition === 'current-pointer-file-readable-header-state-label-conflicts-with-oklahoma-page-link-404'
      && manual.proof_file === 'reconciliation-surgical-oklahoma-pointer-file-proof.json'
      && manual.observed_at === surgicalOklahomaProof.observed_at
      && manual.pointer_sha256 === surgicalOklahomaProof.pointer_sha256
      && manual.pointer_mrf_url === surgicalOklahomaProof.pointer_mrf_url
      && manual.pointer_mrf_sample_sha256 === surgicalOklahomaProof.pointer_mrf_sample_sha256
      && manual.pointer_mrf_license_header === surgicalOklahomaProof.pointer_mrf_license_header
      && manual.pointer_mrf_license_value === surgicalOklahomaProof.pointer_mrf_license_value
      && manual.pricing_page_mrf_link_http_status === 404;
    const groverDilsAliasReviewed = row.ccn === '291312'
      && manual?.disposition === 'first-party-alias-pointer-zip-unresolved-homepage-legacy-csv-readable'
      && manual.proof_file === 'reconciliation-grover-dils-source-review.json'
      && manual.observed_at === groverDilsProof.observed_at
      && manual.pointer_url === groverDilsProof.pointer_url
      && manual.pointer_retained_mrf_url === groverDilsProof.pointer_mrf_url
      && manual.page_linked_mrf_url === groverDilsProof.home_file_url
      && groverDilsProof.pointer_sha256 === current.pointer_corpus_sha256
      && groverDilsProof.current_pointer_file_bytes_verified === false
      && groverDilsProof.pointer_file_client_status === 0;
    const atlanticareCityHeaderReviewed = row.ccn === '310064'
      && manual?.disposition === 'city-pointer-entry-targets-shared-file-with-mainland-only-bounded-header'
      && manual.proof_file === 'reconciliation-atlanticare-city-pointer-proof.json'
      && manual.observed_at === atlanticareCityProof.observed_at
      && manual.pointer_url === atlanticareCityProof.pointer_url
      && manual.pointer_sha256 === current.pointer_corpus_sha256
      && manual.pointer_city_mrf_url === atlanticareCityProof.pointer_city_mrf_url
      && manual.pointer_mainland_mrf_url === atlanticareCityProof.pointer_mainland_mrf_url
      && manual.file_sample_sha256 === atlanticareCityProof.file_sample_sha256
      && manual.file_declared_location_name === atlanticareCityProof.declared_location_name
      && manual.file_declared_address === atlanticareCityProof.declared_address;
    const independence = independenceByCcn.get(row.ccn);
    const grandViewPageLead = row.ccn === grandViewProof.ccn
      && row.proposed_disposition === 'pointer-facility-match-unresolved'
      && current.pointer_corpus_sha256 === grandViewProof.root_pointer_sha256
      && current.pointer_corpus_checked_url === grandViewProof.root_pointer_url
      && grandViewProof.root_pointer_has_grand_view_entry === false
      && grandViewProof.page_file_http_status === 206
      && grandViewProof.page_file_sample_bytes > 0
      && grandViewProof.page_file_total_bytes > grandViewProof.page_file_sample_bytes
      && grandViewProof.declared_license_state === row.state
      && grandViewProof.complete_file_validated === false;
    const averaCase = averaByCcn.get(row.ccn);
    const summitSiteReviewed = row.ccn === summitProof.ccn
      && row.proposed_disposition === 'pointer-not-retrieved'
      && current.official_domain === summitProof.official_domain
      && row.standing_finding === 'not-assessed-site-corrected'
      && summitProof.local_pointer_get_status === 403
      && summitProof.browser_pointer_result === 'ERR_BLOCKED_BY_CLIENT'
      && summitProof.mrf_get_status === 200
      && summitProof.mrf_sample_bytes >= 65536
      && summitProof.declared_license_state === row.state
      && summitProof.complete_file_validated === false;
    const averaAccessReviewed = row.proposed_disposition === 'pointer-facility-match-unresolved'
      && Boolean(averaCase)
      && current.pointer_corpus_sha256 === averaProof.retained_pointer_sha256
      && averaCase.pointer_mrf_url
      && averaCase.browser_result.startsWith('Access Denied')
      && averaProof.disposition.startsWith('All three remain unresolved');
    const independenceAccessReviewed = row.proposed_disposition === 'pointer-facility-match-unresolved'
      && independenceProof.ccns.includes(row.ccn)
      && independence?.retained_pointer_sha256 === current.pointer_corpus_sha256
      && independence?.retained_pointer_url === current.pointer_corpus_checked_url
      && independence?.bounded_head_status === 403
      && independence?.bounded_range_status === 403
      && independence?.pointer_declared_file_url
      && independence?.publisher_page_file_url;
    const coalCountyPageFileReviewed = row.ccn === '371319'
      && row.proposed_disposition === 'pointer-facility-match-unresolved'
      && manual?.disposition === 'first-party-page-file-identity-corroborated-pointer-target-google-sheet'
      && manual.proof_file === 'reconciliation-coal-county-page-file-proof.json'
      && manual.observed_at === coalCountyProof.observed_at
      && manual.pointer_url === coalCountyProof.pointer_url
      && manual.pointer_target_url === coalCountyProof.pointer_target_url
      && manual.page_file_url === coalCountyProof.pricing_page_file_url
      && manual.page_file_sample_sha256 === coalCountyProof.sample_sha256
      && coalCountyProof.pointer_sha256 === current.pointer_corpus_sha256
      && coalCountyProof.file_declared_license_state === row.state;
    const reedsburgPointerCaseReviewed = row.ccn === '521351'
      && row.proposed_disposition === 'pointer-facility-match-unresolved'
      && manual?.disposition === 'pointer-file-client-404-page-file-identity-corroborated-case-different'
      && manual.proof_file === 'reconciliation-reedsburg-pointer-case-proof.json'
      && manual.observed_at === reedsburgProof.observed_at
      && manual.pointer_url === reedsburgProof.pointer_url
      && manual.pointer_mrf_url === reedsburgProof.pointer_file_url
      && manual.pointer_mrf_bounded_status === reedsburgProof.pointer_file_http_status
      && manual.page_file_url === reedsburgProof.page_file_url
      && manual.page_file_sample_sha256 === reedsburgProof.sample_sha256
      && reedsburgProof.pointer_sha256 === current.pointer_corpus_sha256
      && reedsburgProof.file_declared_license_state === row.state;
    const houstonCountyConflictReviewed = row.ccn === '441322'
      && row.proposed_disposition === 'pointer-facility-match-unresolved'
      && manual?.disposition === 'pointer-and-page-linked-file-hospital-name-matches-address-conflicts'
      && manual.proof_file === 'reconciliation-houston-county-address-conflict-proof.json'
      && manual.observed_at === houstonCountyProof.observed_at
      && manual.pointer_url === houstonCountyProof.pointer_url
      && manual.pointer_mrf_url === houstonCountyProof.pointer_and_page_file_url
      && manual.page_file_url === houstonCountyProof.pointer_and_page_file_url
      && manual.complete_file_sha256 === houstonCountyProof.file_sha256
      && manual.file_declared_address === houstonCountyProof.file_declared_address
      && houstonCountyProof.pointer_sha256 === current.pointer_corpus_sha256
      && houstonCountyProof.retained_pointer_obfuscated === true
      && houstonCountyProof.pointer_safe_fields_same_as_retained === true
      && houstonCountyProof.file_declared_license_state === row.state
      && houstonCountyProof.file_declared_address !== houstonCountyProof.pricing_page_facility_address;
    const houstonCrossFacilityReview = row.ccn === '441322'
      && manual?.latest_cross_facility_address_review_2026_09_27?.proof_file === 'reconciliation-houston-county-lexington-cross-facility-proof-2026-09-27.json'
      && manual.latest_cross_facility_address_review_2026_09_27.disposition === 'retain-unmatched-address-conflict';
    const creekhealthFacility = creekhealthProof.facility_pages.find(page => page.ccn === row.ccn);
    const creekhealthSiblingExcluded = row.proposed_disposition === 'pointer-facility-match-unresolved'
      && creekhealthProof.ccns.includes(row.ccn)
      && ['shared-root-pointer-file-belongs-to-okmulgee-sibling', 'complete-sibling-file-exclusion'].includes(manual?.disposition)
      && ['reconciliation-creekhealth-sibling-exclusion-proof.json', 'reconciliation-creekhealth-okmulgee-full-file-proof-2026-09-19.json'].includes(manual.proof_file)
      && (manual.observed_at === (manual.proof_file === 'reconciliation-creekhealth-okmulgee-full-file-proof-2026-09-19.json' ? creekhealthFullProof.observed_at : creekhealthProof.observed_at)
        || (manual.proof_file === 'reconciliation-creekhealth-okmulgee-full-file-proof-2026-09-19.json'
          && Date.parse(manual.observed_at || '') <= Date.parse(creekhealthFullProof.observed_at || '')))
      && manual.pointer_url === creekhealthProof.pointer_url
      && manual.pointer_file_url === creekhealthProof.pointer_file_url
      && manual.pointer_file_sample_sha256 === creekhealthProof.sample_sha256
      && manual.official_facility_page === creekhealthFacility?.url
      && manual.official_facility_address === creekhealthFacility?.address
      && creekhealthProof.pointer_sha256 === current.pointer_corpus_sha256
      && creekhealthProof.file_declared_address !== creekhealthFacility?.address;
    const reviewSources = [
      ['manual-access', manual && {
        ...manual,
        fresh_reviewed_at: latestNestedManualReviewAt(manual),
      }],
      ['state-hospital-scope-review', stateScopeReview && {
        observed_at: stateScopeReview.scope_review.reviewed_at,
        status: stateScopeReview.scope_review.status,
        previous_action: stateScopeReview.previous_action,
        cms_guidance_url: stateScopeReview.scope_review.cms_guidance_url,
        note: stateScopeReview.note,
      }],
      ['reviewed-header', row.reviewed_header_disposition],
      ['cms-enrollment-snapshot', row.cms_enrollment_snapshot],
      ['address-reconciliation', row.address_reconciliation],
      ['official-page-file', row.official_page_file_review],
      ['archive-review', row.archive_review],
      ['archive-content', row.archive_content_proof],
      ['small-archive', row.small_archive_disposition],
      ['direct-file', row.direct_file_review],
      ['browser-address-conflict', row.browser_file_address_conflict],
      ['current-page-pointer-mismatch', row.current_page_pointer_mismatch],
      ['automation-challenge', row.automation_challenge_observation],
      ['independence-access-proof', independenceAccessReviewed ? independenceProof : null],
      ['grand-view-page-file-proof', grandViewPageLead ? grandViewProof : null],
      ['avera-access-proof', averaAccessReviewed ? averaCase : null],
      ['summit-casper-site-proof', summitSiteReviewed ? summitProof : null],
    ].filter(([, value]) => Boolean(value));
    const reviewed = reviewSources.length > 0;
    const identityRouteReviewed = identityRouteProofs.get(row.ccn) === manual?.proof_file
      && manual?.official_site
      && manual?.disposition?.includes('identity-confirmed');
    let nextAction = row.manual_access_observation?.next_action || row.next_action || stage.action;
    const staleScopeExemptionAction = /(?:scope[- ]exempt|deemed-compliant)/i.test(String(manual?.previous_scope_review_assessment?.next_action || ''));
    if (stateScopeReview && staleScopeExemptionAction) {
      nextAction = String(stateScopeReview.scope_review.next_action || '')
        .replace(/^Keep this CCN in the unresolved investigation queue\.\s*Find a current/i, 'Keep the facility unresolved. Locate and verify a current')
        || 'Keep the facility unresolved. Locate and verify a current facility-specific CMS MRF or obtain authoritative evidence that this exact hospital qualifies for a CMS exception; do not infer noncompliance from missing files or transport failures.';
    }
    if (houstonCrossFacilityReview) nextAction = manual.latest_cross_facility_address_review_2026_09_27.next_action;
    const neshobaHistoricalCcnReview = row.ccn === '250043'
      && row.reviewed_header_disposition?.proof_file === 'reconciliation-neshoba-qies-query-discrepancy-and-operator-page-recheck-2026-09-27.json'
      && row.reviewed_header_disposition.disposition === 'historical-acute-ccn-hpt-coverage-unresolved';
    if (neshobaHistoricalCcnReview) nextAction = row.reviewed_header_disposition.next_action;
    // A later browser denial cannot be resolved by assigning the same browser
    // retry again. Keep the access result separate from any file-validity claim.
    if (!row.manual_access_observation?.next_action
        && row.proposed_disposition === 'mrf-request-unsuccessful'
        && current.browser_mrf_status === 'http-denied'
        && /^Retry the exact pointer-declared MRF in a browser\/download-capable client\.?$/.test(nextAction)) {
      nextAction = 'A browser already observed HTTP denial for the exact pointer-declared file. Confirm the first-party pricing-page link and seek a publisher-corrected pointer or accessible file route before another bounded header check; do not infer the file is absent from this client denial.';
    }
    if (independenceAccessReviewed) nextAction = row.ccn === '390168'
      ? 'Obtain a permitted byte-backed header for the Butler page-linked file, resolve its case-sensitive URL difference from the retained pointer target, then compare declared facility/address/state/date/version before changing status.'
      : 'Obtain a permitted byte-backed header from the exact page-and-pointer-linked file, then compare declared facility/address/state/date/version before changing status; the current client 403 is not file absence.';
    if (grandViewPageLead) nextAction = 'Preserve the first-party Grand View page-linked CSV and its exact-campus bounded header; review the 438 MB file with bounded streaming if needed, and recheck the root pointer for a Grand View entry after publisher change. Do not treat the page file as pointer-linked or fully validated.';
    if (averaAccessReviewed) nextAction = row.ccn === '431308'
      ? 'Seek authorized exact-file bytes through a materially different route or publisher copy; resolve the pointer label for the 202 J Ave nursing site against the 200 J Ave hospital before assigning file identity. Do not repeat the denied browser request or infer file absence.'
      : 'Seek authorized exact-file bytes through a materially different route or publisher copy; check declared hospital/location/address/state/date/version for this CCN before assigning the shared-system file. Do not repeat the denied browser request or infer file absence.';
    if (!nextAction) throw new Error(`No next action for ${row.ccn}`);
    return {
      ccn: row.ccn,
      hospital_name: row.hospital_name,
      state: row.state,
      official_domain: current.official_domain || '',
      publisher_domain_lead: row.manual_access_observation?.publisher_domain_lead || '',
      current_disposition: neshobaHistoricalCcnReview ? row.reviewed_header_disposition.disposition
        : summitSiteReviewed ? 'corrected-site-web-pointer-visible-client-blocked-file-header-found'
        : grandViewPageLead ? 'root-pointer-omits-facility-page-file-header-found'
        : averaAccessReviewed ? 'first-party-labeled-file-client-access-denied'
        : independenceAccessReviewed ? 'first-party-labeled-file-client-access-denied'
        : scenicTransitionReviewed ? scenicProof.disposition
        : southeasternAliasReviewed ? southeasternProof.disposition
        : identityRouteReviewed || pointerIdentityReviewed || centraLynchburgReviewed || southOaksRootReviewed || parkviewFileAccessReviewed || surgicalOklahomaHeaderReviewed || groverDilsAliasReviewed || atlanticareCityHeaderReviewed || coalCountyPageFileReviewed || reedsburgPointerCaseReviewed || houstonCountyConflictReviewed || creekhealthSiblingExcluded ? manual.disposition : row.proposed_disposition,
      ...(neshobaHistoricalCcnReview || pointerIdentityReviewed || centraLynchburgReviewed || southOaksRootReviewed || parkviewFileAccessReviewed || surgicalOklahomaHeaderReviewed || groverDilsAliasReviewed || atlanticareCityHeaderReviewed || independenceAccessReviewed || grandViewPageLead || averaAccessReviewed || summitSiteReviewed || coalCountyPageFileReviewed || reedsburgPointerCaseReviewed || houstonCountyConflictReviewed || creekhealthSiblingExcluded || scenicTransitionReviewed || southeasternAliasReviewed ? { nationwide_disposition: row.proposed_disposition } : {}),
      standing_finding: row.standing_finding,
      prior_finding: row.prior_finding,
      investigation_tier: stage.tier,
      evidence_gate: stateScopeReview ? 'facility-specific-mrf-or-authoritative-exception-basis'
        : neshobaHistoricalCcnReview ? 'historical-hpt-coverage-through-2025-12-31'
        : summitSiteReviewed ? 'pointer-bytes-and-complete-file-review'
        : grandViewPageLead ? 'pointer-entry-and-complete-file-review'
        : averaAccessReviewed ? 'exact-file-access-and-campus-attribution'
        : scenicTransitionReviewed ? 'ccn-enrollment-continuity-and-complete-file'
        : southeasternAliasReviewed ? 'pointer-and-page-file-access-and-header'
        : creekhealthSiblingExcluded ? 'facility-specific-pointer-and-file'
        : houstonCountyConflictReviewed ? 'file-address-conflict'
        : reedsburgPointerCaseReviewed ? 'pointer-url-correction-and-complete-file'
        : coalCountyPageFileReviewed ? 'pointer-target-and-complete-file'
        : independenceAccessReviewed ? row.ccn === '390168' ? 'file-access-and-url-equivalence' : 'file-access'
        : atlanticareCityHeaderReviewed ? 'city-file-identity-and-scope'
        : southOaksRootReviewed ? 'facility-specific-pointer-entry-or-page-file'
        : identityRouteReviewed ? 'facility-specific-pointer-and-file'
        : pointerIdentityReviewed || centraLynchburgReviewed || parkviewFileAccessReviewed ? 'file-access'
        : surgicalOklahomaHeaderReviewed ? 'file-header-and-page-linkage'
          : groverDilsAliasReviewed ? 'pointer-file-access-and-role' : stage.gate,
      reviewed_follow_up: reviewed,
      reviewed_sources: reviewSources.map(([name]) => name),
      ...(row.cms_enrollment_snapshot
        ? { cms_enrollment_snapshot_rows: row.cms_enrollment_snapshot.rows.length } : {}),
      latest_review_at: reviewSources.map(([, value]) =>
        isoReviewDate(value.fresh_reviewed_at || value.observed_at || value.checked_at || value.reviewed_at || '')
      ).filter(Boolean).sort().at(-1) || '',
      candidate_file_recorded: Boolean(summitSiteReviewed || grandViewPageLead || averaAccessReviewed || independenceAccessReviewed || centraLynchburgReviewed || row.candidate_mrf_url || manual?.page_file_url
        || manual?.pointer_mrf_url || manual?.pointer_retained_mrf_url
        || manual?.page_linked_mrf_url || manual?.page_linked_mrf_urls?.length),
      last_browser_file_status: current.browser_mrf_status || '',
      last_browser_file_observed_at: current.browser_mrf_observed_at || '',
      next_action: nextAction,
    };
  }).sort((a, b) => a.investigation_tier - b.investigation_tier
      || Number(a.reviewed_follow_up) - Number(b.reviewed_follow_up)
      || a.ccn.localeCompare(b.ccn));
  if (new Set(records.map(row => row.ccn)).size !== records.length) throw new Error('Duplicate CCN in worklist');
  const byTier = Object.fromEntries([1, 2, 3, 4, 5].map(tier => [tier,
    records.filter(row => row.investigation_tier === tier).length]));
  return { summary: { total: records.length, by_tier: byTier,
    already_reviewed_follow_ups: records.filter(row => row.reviewed_follow_up).length }, records };
}

function main() {
  const reconciliation = JSON.parse(fs.readFileSync(reconciliationPath, 'utf8'));
  const verification = JSON.parse(fs.readFileSync(verificationPath, 'utf8'));
  const result = build(reconciliation, verification);
  result.source_sha256 = {
    'nationwide-reconciliation.json': shaFile(reconciliationPath),
    'nationwide-verification.json': shaFile(verificationPath),
    'reviewed-resolutions.json': shaFile(reviewedResolutionsPath),
    'reconciliation-independence-health-access-proof.json': shaFile(independenceProofPath),
    'reconciliation-coal-county-page-file-proof.json': shaFile(path.join(audit, 'reconciliation-coal-county-page-file-proof.json')),
    'reconciliation-reedsburg-pointer-case-proof.json': shaFile(path.join(audit, 'reconciliation-reedsburg-pointer-case-proof.json')),
    'reconciliation-houston-county-address-conflict-proof.json': shaFile(path.join(audit, 'reconciliation-houston-county-address-conflict-proof.json')),
    'reconciliation-creekhealth-sibling-exclusion-proof.json': shaFile(path.join(audit, 'reconciliation-creekhealth-sibling-exclusion-proof.json')),
    'reconciliation-grand-view-page-file-lead-proof.json': shaFile(grandViewProofPath),
    'reconciliation-avera-three-site-access-proof.json': shaFile(averaProofPath),
    'reconciliation-summit-casper-site-proof.json': shaFile(summitProofPath),
    'reconciliation-roosevelt-general-current-pricing-route-review-2026-09-27.json': shaFile(path.join(audit,
      'reconciliation-roosevelt-general-current-pricing-route-review-2026-09-27.json')),
    'reconciliation-carrus-lakeside-successor-pricing-scope-review-2026-09-27.json': shaFile(path.join(audit,
      'reconciliation-carrus-lakeside-successor-pricing-scope-review-2026-09-27.json')),
    'reconciliation-alaska-psychiatric-institute-state-scope-review-2026-09-27.json': shaFile(path.join(audit,
      'reconciliation-alaska-psychiatric-institute-state-scope-review-2026-09-27.json')),
    'reconciliation-howard-university-third-party-exact-file-lead-2026-09-27.json': shaFile(path.join(audit,
      'reconciliation-howard-university-third-party-exact-file-lead-2026-09-27.json')),
    'reconciliation-howard-university-downloaded-file-review-2026-09-27.json': shaFile(path.join(audit,
      'reconciliation-howard-university-downloaded-file-review-2026-09-27.json')),
    'reconciliation-minidoka-procedureradar-current-mrf-link-conflict-2026-09-27.json': shaFile(path.join(audit,
      'reconciliation-minidoka-procedureradar-current-mrf-link-conflict-2026-09-27.json')),
    'reconciliation-lifebrite-early-live-pricing-page-review-2026-09-28.json': shaFile(path.join(audit,
      'reconciliation-lifebrite-early-live-pricing-page-review-2026-09-28.json')),
    'reconciliation-griffin-negotiated-rates-portal-terms-review-2026-09-28.json': shaFile(path.join(audit,
      'reconciliation-griffin-negotiated-rates-portal-terms-review-2026-09-28.json')),
    'reconciliation-rolling-hills-tennessee-domain-lead-2026-09-28.json': shaFile(path.join(audit,
      'reconciliation-rolling-hills-tennessee-domain-lead-2026-09-28.json')),
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result.summary));
}

if (require.main === module) main();
module.exports = { build, stages };
