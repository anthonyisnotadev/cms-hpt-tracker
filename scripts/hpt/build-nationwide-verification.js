'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { toRFC4180, normalizeUrl } = require('./pointer-corpus');
const { loadReviewedView } = require('./lib/reviewed-resolutions');
const { applyReviewedVerificationOverlays } = require('./lib/reviewed-verification-overlays');
const { strongAddressAgreement, distinctiveNameOverlap } = require('./lib/mrf-header-match');
const { normalizeName } = require('./lib/util');
const { isSupportedIdentityUncertainty, reviewedResolutionSupersedes, resolutionObservedAt,
  reviewedResolutionIsSameObservation, sameResolvedPointerRetry, standingEvidenceRetained } = require('./lib/reconciliation-precedence');
const { isCurrentTemplateVersion } = require('./lib/probe');

const ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(ROOT, 'data', 'hpt-audit');
const PRIVATE = path.join(ROOT, 'cms_data', 'hpt', 'nationwide-verification');
const POINTER_DIR = path.join(ROOT, 'cms_data', 'hpt', 'pointer-corpus');
const split = value => [...new Set(String(value || '').split('|').map(item => item.trim()).filter(Boolean))];
const add = (map, key, row) => { if (!map.has(key)) map.set(key, []); map.get(key).push(row); };
function hostnameFromUrl(value) {
  try {
    const raw = String(value || '').trim();
    const hostname = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
    return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(hostname)
      ? hostname : '';
  } catch { return ''; }
}

function qualifyBrowserIdentity(review, hospital, addressReview = null) {
  if (!review || review.identity === 'conflicting') return review;
  // Identity gates describe parsed file content. A navigation/fetch failure
  // has no file identity to adjudicate and must remain solely a transport
  // observation rather than acquiring a misleading missing-name defect.
  if (review.status !== 'retrieved') return review;
  const addresses = split(review.declared_address);
  const names = split(review.declared_hospital_name).concat(split(review.declared_location_name));
  const name = hospital?.name || hospital?.hospital_name || '';
  const nameAgrees = !!name && names.some(value => normalizeName(value) === normalizeName(name) || distinctiveNameOverlap(value, name));
  const state = String(hospital?.state || '').toUpperCase();
  const recordedState = String(review.declared_license_state || '').toUpperCase();
  const reviewedAddress = addressReview && hospital && addressReview.ccn === hospital.ccn
    && addressReview.state === state && addressReview.roster_address === hospital.address
    && addressReview.file_address === review.declared_address && addressReview.mrf_url === review.target
    && addressReview.browser_observed_at === review.observed_at && !!addressReview.basis
    && /^https:\/\//.test(addressReview.source_url || '')
    && Number.isFinite(Date.parse(addressReview.reviewed_on))
    && Date.parse(addressReview.reviewed_on + 'T23:59:59Z') >= Date.parse(review.observed_at)
    && (!recordedState || recordedState === state);
  // A reviewed first-party address equivalence may also document an operator
  // or legal-name relationship (for example, a hospital facility named in
  // the CMS roster while the MRF uses its parent association name). In that
  // case the exact address/state plus the dated first-party review closes the
  // name-alias gap without rewriting the file header.
  const reviewedOperatorAlias = reviewedAddress && /operator|operated|association|parent|rename|facility|typo|misspell/i.test(String(addressReview.basis || ''));
  if ((nameAgrees || reviewedOperatorAlias) && reviewedAddress) return { ...review, identity: 'corroborated', identity_gate: reviewedOperatorAlias && !nameAgrees ? 'reviewed-file-address-operator-alias' : 'reviewed-file-address-equivalence', address_review: addressReview };
  const addressAgrees = !!hospital?.address && addresses.some(value => strongAddressAgreement(hospital.address, value)
    && (recordedState ? recordedState === state : new RegExp('\\b' + state + '\\b', 'i').test(normalizeName(value))));
  if (nameAgrees && addressAgrees) return { ...review, identity_gate: 'recorded-file-name-street-state-agree' };
  return { ...review, identity: 'unverified', identity_gate: !names.length ? 'file-name-not-recorded'
    : !nameAgrees ? 'file-name-reconciliation-required' : !addresses.length ? 'file-address-not-recorded' : 'file-address-reconciliation-required' };
}

function parseDeclaredDate(value) {
  const input = String(value || '').trim();
  let year;
  let month;
  let day;
  if (input.includes('/')) [month, day, year] = input.split('/').map(Number);
  else if (input.includes('-')) [year, month, day] = input.split('-').map(Number);
  else return NaN;
  if (![year, month, day].every(Number.isInteger)) return NaN;
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? timestamp : NaN;
}

function metadataState(row, now = Date.now()) {
  // A declared older template is independently actionable even when the
  // publisher also omits last_updated_on. Do not let the missing date erase
  // the stronger, directly observed version evidence.
  if (!row.mrf_last_updated) return row.mrf_cms_version && !isCurrentTemplateVersion(row.mrf_cms_version)
    ? 'verified-older-or-unresolved-template' : 'metadata-unresolved';
  const declaredAt = parseDeclaredDate(row.mrf_last_updated);
  const days = Number.isFinite(declaredAt)
    ? Math.floor((now - declaredAt) / 86400000) : Number(row.mrf_days_since_update);
  // Freshness is evaluated for the snapshot being built, not frozen at the
  // older time when a cached header was first probed. Prefer the declared
  // date over cached age/boolean fields so same-URL updates can restore status.
  if ((Number.isFinite(days) && days > 365)
      || (!Number.isFinite(declaredAt) && row.mrf_stale_over_365 === 'yes')) return 'verified-stale-date';
  if (!isCurrentTemplateVersion(row.mrf_cms_version)) return 'verified-older-or-unresolved-template';
  return 'verified-current-v3';
}

function effectiveDispositionCategory(row) {
  if (String(row.disposition || '').startsWith('scope-exempt')) return 'scope-exempt';
  if (row.supported_identity_uncertainty) return 'supported-identity-uncertainty';
  if (row.latest_observation_superseded) return 'superseded-by-reviewed-resolution';
  if (row.standing_evidence_retained && row.disposition === 'pointer-facility-match-unresolved')
    return 'genuinely-unresolved';
  if (row.standing_evidence_retained) return 'standing-evidence-retained';
  if (String(row.disposition || '').startsWith('verified-')) return 'active-verification-claim';
  return 'genuinely-unresolved';
}

function browserMetadataState(review, now = Date.now()) {
  return metadataState({
    mrf_last_updated: review.declared_last_updated,
    mrf_days_since_update: review.declared_last_updated
      ? Math.floor((Date.now() - Date.parse(review.declared_last_updated)) / 86400000) : '',
    mrf_cms_version: review.cms_template_version
  }, now);
}

function completeFullFileObservation(record) {
  const validator = record.cms_validator || {};
  if (record.full_file_validated === true && ['json', 'application/json'].includes(record.file_kind)
      && Number(record.file_range_status || record.file_status) === 200
      && Number(record.file_bytes) > 0
      && Number(record.file_bytes) === Number(record.full_file_bytes)
      && /^[a-f0-9]{64}$/i.test(String(record.file_sha256 || ''))
      && record.file_sha256.toLowerCase() === String(record.full_file_sha256 || '').toLowerCase()
      && record.json_schema_version === '3.0.0'
      && Number(record.json_data_rows) > 0
      && Number(record.json_usable_charge_rows) > 0
      && validator.package === '@cmsgov/hpt-validator-cli'
      && validator.version === '1.10.8'
      && validator.format === 'json' && validator.requirements === 'v3.0'
      && validator.valid === true && Number(validator.error_count) === 0
      && Number(validator.alert_count) === Number(validator.alert ? 1 : 0)
      && (!validator.alert || (Number(validator.alert_count) === 1
        && record.cms_template_version === '3.0'
        && /version data element/.test(validator.alert)
        && /"3\.0"/.test(validator.alert) && /"3\.0\.0"/.test(validator.alert)))) return true;
  if (record.full_file_validated === true
      && Number(record.file_range_status) === 200
      && Number(record.file_bytes) > 0
      && Number(record.file_bytes) === Number(record.full_file_bytes)
      && /^[a-f0-9]{64}$/i.test(String(record.file_sha256 || ''))
      && record.file_sha256.toLowerCase() === String(record.full_file_sha256 || '').toLowerCase()
      && Number(record.parsed_data_rows) > 0
      && Number(record.csv_header_columns) > 0
      && Array.isArray(record.csv_data_row_widths)
      && record.csv_data_row_widths.length === 1
      && Number(record.csv_data_row_widths[0]) === Number(record.csv_header_columns)
      && validator.package === '@cmsgov/hpt-validator-cli'
      && validator.version
      && validator.format === 'csv'
      && validator.requirements === 'v3.0'
      && validator.valid === true
      && Number(validator.error_count) === 0
      && Number(validator.alert_count) === 0) return true;
  if (record.full_file_validated !== true || ![200, 206].includes(Number(record.file_range_status))
      || Number(record.file_bytes) !== Number(record.full_file_bytes)
      || record.file_sha256 !== record.full_file_sha256
      || !(Number(record.parsed_data_rows) > 0)
      || Number(record.parsed_data_rows) !== Number(record.data_rows_with_description)
      || Number(record.parsed_data_rows) !== Number(record.data_rows_with_gross_charge)
      || Number(record.parsed_data_rows) !== Number(record.data_rows_with_payer)
      || (Number(record.parsed_data_rows) !== Number(record.data_rows_with_usable_negotiated_charge)
        && Number(record.parsed_data_rows) !== Number(record.data_rows_with_negotiated_dollar))
      || !Array.isArray(record.csv_data_row_widths) || record.csv_data_row_widths.length !== 1
      || Number(record.csv_data_row_widths[0]) !== Number(record.csv_header_columns)) return false;
  if (Number(record.file_range_status) === 206) {
    const range = /^bytes\s+0-(\d+)\/(\d+)$/i.exec(String(record.file_content_range || ''));
    return !!range && Number(range[1]) + 1 === Number(record.file_bytes)
      && Number(range[2]) === Number(record.full_file_bytes);
  }
  return true;
}

// Keep the metadata and timestamp attached to the observation supporting the
// disposition. Browser retry details remain separate and cannot refresh or
// overwrite a matched header's evidence merely by being present.
function selectedFileEvidence(selected, candidate, review) {
  const fromBrowser = !selected.best && !selected.review.length && selected.linked.length
    && review?.status === 'retrieved' && review.identity === 'corroborated';
  if (fromBrowser) return {
    declared_hospital_name: review.declared_hospital_name || '',
    declared_location_name: review.declared_location_name || '',
    declared_address: review.declared_address || '',
    declared_license_state: review.declared_license_state || '',
    declared_last_updated: review.declared_last_updated || '',
    cms_template_version: review.cms_template_version || '',
    observed_at: review.observed_at || '', metadata_source: 'reviewed-browser'
  };
  return {
    declared_hospital_name: candidate?.mrf_hospital_name || '',
    declared_location_name: candidate?.mrf_location_name || '',
    declared_address: candidate?.mrf_address || '',
    declared_license_state: candidate?.mrf_license_state || '',
    declared_last_updated: candidate?.mrf_last_updated || '',
    cms_template_version: candidate?.mrf_cms_version || '',
    observed_at: candidate?.checked_at || '', metadata_source: candidate ? 'header-observation' : 'none'
  };
}

function choose(rows, ccn, hospitalName = '', now = Date.now()) {
  const matched = rows.filter(row => split(row.header_matched_ccns).includes(ccn));
  const review = rows.filter(row => split(row.review_ccns).includes(ccn));
  const linked = rows.filter(row => split(row.existing_matched_ccns).includes(ccn));
  const rank = row => ({ 'verified-current-v3': 5, 'verified-stale-date': 4,
    'verified-older-or-unresolved-template': 3, 'metadata-unresolved': 2 }[metadataState(row, now)] || 0);
  // Probe completion time is not a publisher revision. If two equally ranked
  // files declare the same update date, prefer the one naming this facility;
  // an address-only sibling match must not displace an exact-name file.
  const exactName = row => !!hospitalName && normalizeName(row.mrf_hospital_name || '') === normalizeName(hospitalName);
  matched.sort((a, b) => rank(b) - rank(a)
    || (a.mrf_last_updated === b.mrf_last_updated ? Number(exactName(b)) - Number(exactName(a)) : 0)
    || String(b.checked_at).localeCompare(String(a.checked_at)));
  return { best: matched[0] || null, matched, review, linked };
}

function headerEvidenceForSelection(selected, candidate, ccn) {
  if (!candidate) return { identity_gate: '', match_reason: '' };
  if (selected.best === candidate) return {
    identity_gate: candidate.identity_gate || '', match_reason: candidate.match_reason || ''
  };
  if (selected.review.includes(candidate)) return {
    identity_gate: '', match_reason: candidate.match_reason || ''
  };
  const matchedCcns = split(candidate.header_matched_ccns);
  return {
    identity_gate: '',
    match_reason: matchedCcns.length && !matchedCcns.includes(ccn)
      ? 'linked-file-matched-different-facility' : candidate.match_reason || ''
  };
}

const retainedPointerCache = new Map();
function pointerRawIntegrity(target, root = ROOT, cache = retainedPointerCache) {
  if (!target?.rawFile || !/^[a-f0-9]{64}$/i.test(target.sha256 || '')) return '';
  const file = path.resolve(root, target.rawFile);
  if (!file.startsWith(root + path.sep)) return 'raw-file-unavailable';
  let actual = cache.get(file);
  if (!actual) {
    try {
      const bytes = fs.readFileSync(file);
      actual = { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
      cache.set(file, actual);
    } catch { return 'raw-file-unavailable'; }
  }
  return actual.sha256 === target.sha256 && actual.bytes === Number(target.bytes)
    ? 'hash-corroborated' : 'hash-conflict';
}

function pointerRetainedBytesStatus(target, root = ROOT, cache = retainedPointerCache) {
  return target?.status === 'ok' ? pointerRawIntegrity(target, root, cache) : '';
}

function pointerCorpusProvenance(target) {
  if (target?.status !== 'ok') {
    // Legacy crawl state spread a failed retry over the previous success,
    // leaving old raw-file/hash fields beside the new failed status/date.
    // Preserve that capture as historical only when its bytes still match.
    const prior = target?.reason === 'html-body-not-pointer' ? null
      : [...(target?.history || [])].reverse().find(item => item.status === 'ok');
    const snapshot = target?.lastSuccessful || (prior ? { ...target, fetchedAt: prior.at,
      acceptedUrl: prior.acceptedUrl || target.acceptedUrl,
      finalUrl: prior.finalUrl || target.finalUrl } : null);
    const integrity = snapshot ? pointerRawIntegrity(snapshot) : '';
    return snapshot && integrity ? {
      historical_checked_url: /^https?:\/\//i.test(snapshot.acceptedUrl || '') ? snapshot.acceptedUrl : '',
      historical_final_url: snapshot.finalUrl || '',
      historical_sha256: snapshot.sha256 || '',
      historical_observed_at: snapshot.fetchedAt || '',
      historical_raw_integrity: integrity
    } : {};
  }
  return {
    corpus_checked_url: /^https?:\/\//i.test(target?.input || '') ? target.input : target?.acceptedUrl || '',
    corpus_final_url: target?.finalUrl || '',
    corpus_sha256: target?.sha256 || '',
    corpus_observed_at: target?.fetchedAt || '',
    corpus_raw_integrity: pointerRetainedBytesStatus(target)
  };
}

function pointerObservation(row, state, corpusRows) {
  const exact = row.pointer_url ? state.targets[`url:${normalizeUrl(row.pointer_url)}`] : null;
  const domain = row.domain ? state.targets[`domain:${String(row.domain).replace(/^www\./i, '').toLowerCase()}`] : null;
  const linked = corpusRows.some(item => split(item.matched_ccns).includes(row.ccn));
  const target = exact || domain;
  const provenance = pointerCorpusProvenance(target);
  if (linked) return { state: 'retrieved-facility-linked', observed_at: target?.fetchedAt || '',
    result: target?.status || 'ok', reason: '', ...provenance };
  if (!row.domain) return { state: 'not-assessed-no-official-domain', observed_at: '', result: '', reason: 'No official domain is currently corroborated.' };
  if (!target) return { state: 'request-not-covered', observed_at: '', result: '', reason: 'The fresh pointer corpus did not contain a target for the recorded domain.' };
  if (target.status === 'ok') return { state: 'retrieved-facility-match-unresolved', observed_at: target.fetchedAt || '',
    result: 'ok', reason: 'A structured pointer was retrieved, but no entry was safely linked to this CCN.', ...provenance };
  return { state: target.reason === 'blocked' ? 'access-denied-or-rate-limited-to-client'
    : target.reason === 'neterr' || target.status === 'failed' ? 'request-or-tool-failure'
      : 'not-retrieved-from-checked-locations', observed_at: target.fetchedAt || state.updatedAt || '',
    result: target.status || '', reason: target.reason || 'pointer not retrieved', ...provenance };
}

function manualPageFileRecheck(record) {
  const gate = String(record.manual_identity_gate || '');
  const url = record.facility_file_url || record.page_file_url || record.publisher_file_url || record.mrf_url || '';
  const bytes = Number(record.file_bytes || record.file_sample_bytes || record.mrf_total_bytes
    || record.publisher_file_total_bytes || record.publisher_file_sample_bytes || record.publisher_file_recheck_sample_bytes
    || record.facility_file_bytes || record.facility_file_sample_bytes || record.page_file_bytes || record.page_file_sample_bytes) || 0;
  const sha = record.file_sha256 || record.file_sample_sha256 || record.mrf_sha256
    || record.publisher_file_sample_sha256 || record.publisher_file_prefix_sha256 || record.publisher_file_recheck_sample_sha256
    || record.facility_file_sha256 || record.facility_file_sample_sha256 || record.page_file_sha256 || record.page_file_sample_sha256 || '';
  const name = record.declared_hospital_name || record.page_file_declared_name || record.facility_file_declared_name || record.publisher_file_declared_name || record.official_facility_name || '';
  const location = record.declared_location_name || record.page_file_declared_location_name || record.page_file_declared_name || record.facility_file_declared_location_name || record.facility_file_declared_name || record.publisher_file_declared_location_name || record.publisher_file_declared_name || record.official_facility_name || '';
  const address = record.declared_address || record.page_file_declared_address || record.facility_file_declared_address || record.publisher_file_declared_address || record.official_facility_address || '';
  const state = record.declared_license_state || record.page_file_license_state || record.facility_file_license_state || record.publisher_file_license_state || '';
  const date = record.declared_last_updated || record.declared_date || record.page_file_declared_last_updated || record.page_file_declared_update || record.facility_file_declared_last_updated || record.publisher_file_declared_last_updated || '';
  const version = record.cms_template_version || record.declared_version || record.page_file_cms_template_version || record.facility_file_cms_template_version || record.publisher_file_cms_template_version || '';
  const hasIdentity = !!name && !!location && !!address && (!!state || gate === 'reviewed-file-address-equivalence');
  const pageLinkedGate = /file-header|file-name-address|complete-file-identity/i.test(gate) || gate === 'reviewed-file-address-equivalence'
    || !record.pointer_url || !/(?:^|\/)\w+\.txt(?:$|[?#])/i.test(String(record.pointer_url));
  if (!url || bytes <= 0 || !/^[a-f0-9]{64}$/i.test(sha) || !hasIdentity || !pageLinkedGate
      || !/^(verified-current-mrf|verified-stale-mrf|verified-template-review|mrf-facility-identity-unresolved)$/.test(record.disposition || '')) return null;
  const observedAt = record.observed_at || (record.observed_on ? `${record.observed_on}T23:59:59Z` : '');
  if (!observedAt || !Number.isFinite(Date.parse(observedAt))) return null;
  return {
    observed_at: observedAt,
    proof_file: record.proof_file || '',
    pointer_url: '',
    source_page_url: record.official_pricing_page || record.official_page_url || '',
    pointer_http_status: Number(record.official_page_status || record.facility_file_status || record.page_file_http_status || record.mrf_http_status || 200),
    pointer_declared_location_name: location,
    pointer_declared_mrf_url: url,
    exact_pointer_mrf_status: Number(record.file_status || record.publisher_file_status || record.page_file_http_status || record.mrf_http_status || record.file_range_status || 200),
    manual_file_only: true,
    file_kind: record.file_kind || record.publisher_file_content_type || '',
    manual_identity_gate: gate || 'official-page-file-header-name-address-state-agree',
    file_bytes: bytes,
    file_sha256: sha.toLowerCase(),
    declared_hospital_name: name,
    declared_location_name: location,
    declared_address: address,
    declared_license_state: state,
    declared_last_updated: date || record.file_declared_date_from_name || '',
    cms_template_version: version,
    declared_npi: record.declared_npi || '',
    manual_identity: record.manual_identity || 'corroborated',
    attestation: record.attestation === true || record.declared_attestation === true,
    declared_npi: record.declared_npi || '',
    manual_disposition: record.disposition,
    next_action: record.next_action || ''
  };
}

function buildTargetIndexes(state) {
  const urls = new Map(), domains = new Map(), ccns = new Map();
  // Crawl state retains both domain-seeded checks and later exact-URL checks.
  // Object insertion order is not observation order: a week-old domain entry
  // can otherwise overwrite newer bytes for the same root. Preserve a prior
  // successful retrieval over a later transport failure, and select the most
  // recent observation within the same success class.
  const prefer = (map, key, target) => {
    if (!key) return;
    const prior = map.get(key);
    if (!prior || (target.status === 'ok' && prior.status !== 'ok')
      || (target.status === prior.status
        && String(target.fetchedAt || '') > String(prior.fetchedAt || ''))) map.set(key, target);
  };
  for (const [key, target] of Object.entries(state.targets || {})) {
    const values = [target.input, target.acceptedUrl, target.finalUrl, ...(target.observedUrls || [])];
    for (const value of values) {
      const normalized = normalizeUrl(value);
      prefer(urls, normalized, target);
    }
    if (key.startsWith('url:')) prefer(urls, normalizeUrl(key.slice(4)), target);
    for (const domain of target.sourceDomains || []) prefer(domains, String(domain).replace(/^www\./i, '').toLowerCase(), target);
    if (key.startsWith('domain:')) prefer(domains, key.slice(7).replace(/^www\./i, '').toLowerCase(), target);
    for (const ccn of target.relatedCcns || []) prefer(ccns, ccn, target);
  }
  return { urls, domains, ccns };
}

function indexedPointerObservation(row, indexes, corpusRows, selectedMrfUrl = '') {
  // A standing pointer may refer to a different hospital. Attribute a
  // selected, CCN-matched file only to the exact retained pointer row that
  // supplied it, never to a related-CCN sibling or the standing URL.
  const supplyingRows = selectedMrfUrl ? corpusRows.filter(item => item.mrf_url === selectedMrfUrl
    && split(item.matched_ccns).includes(row.ccn) && item.record_status === 'ok') : [];
  const supplyingUrls = [...new Set(supplyingRows.map(item => normalizeUrl(item.pointer_url)).filter(Boolean))];
  const evidencedTargets = supplyingUrls.map(url => ({ url, target: indexes.urls.get(url) }))
    .filter(({ url, target }) => target?.status === 'ok'
      && supplyingRows.some(item => normalizeUrl(item.pointer_url) === url && item.pointer_sha256 === target.sha256));
  // The same retained pointer bytes may be served from multiple first-party
  // aliases. Prefer the selected hospital's reviewed root; absent that, only
  // attribute bytes when every supplying alias agrees on the same hash.
  const preferred = evidencedTargets.find(({ url }) => url === normalizeUrl(row.pointer_url));
  const selectedTarget = preferred?.target || (evidencedTargets.length
    && new Set(evidencedTargets.map(({ target }) => target.sha256)).size === 1
    ? evidencedTargets[0].target : null);
  const target = selectedTarget || (row.pointer_url && indexes.urls.get(normalizeUrl(row.pointer_url)))
    || (row.domain && indexes.domains.get(String(row.domain).replace(/^www\./i, '').toLowerCase()))
    // relatedCcns are domain-level leads, not proof that a different
    // publisher's pointer belongs to this CCN. Use them only when the
    // corrected/recorded hospital domain has no indexed root observation.
    || indexes.ccns.get(row.ccn);
  const linked = selectedMrfUrl ? !!selectedTarget : corpusRows.some(item => split(item.matched_ccns).includes(row.ccn));
  const provenance = pointerCorpusProvenance(target);
  if (linked) return { state: 'retrieved-facility-linked', observed_at: target?.fetchedAt || '', result: target?.status || 'ok', reason: '', ...provenance };
  if (!row.domain) return { state: 'not-assessed-no-official-domain', observed_at: '', result: '', reason: 'No official domain is currently corroborated.' };
  if (!target) return { state: 'request-not-covered', observed_at: '', result: '', reason: 'The fresh pointer corpus did not contain a target for the recorded domain.' };
  if (target.status === 'ok') return { state: 'retrieved-facility-match-unresolved', observed_at: target.fetchedAt || '', result: 'ok', reason: 'A structured pointer was retrieved, but no entry was safely linked to this CCN.', ...provenance };
  return { state: target.reason === 'blocked' ? 'access-denied-or-rate-limited-to-client'
    : target.reason === 'neterr' || target.status === 'failed' ? 'request-or-tool-failure'
      : 'not-retrieved-from-checked-locations', observed_at: target.fetchedAt || '', result: target.status || '', reason: target.reason || 'pointer not retrieved', ...provenance };
}

function applyBrowserPointerObservation(pointer, row, browserByUrl) {
  const target = row.pointer_url || (row.domain ? `https://${row.domain}/cms-hpt.txt` : '');
  const review = target ? browserByUrl.get(normalizeUrl(target)) : null;
  if (!review) return { ...pointer, browser: null };
  // Browser navigation is a separate client observation. An error page or
  // rendered text without retained structured bytes cannot erase an earlier
  // hash-corroborated pointer; keep its timestamp and expose the browser
  // outcome in the separate browser fields.
  if (pointer.state.startsWith('retrieved-') && pointer.corpus_raw_integrity === 'hash-corroborated')
    return { ...pointer, browser: review };
  const common = { ...pointer, observed_at: review.observed_at || pointer.observed_at, result: review.status,
    reason: review.detail || review.title || review.status, browser: review };
  if (review.status === 'retrieved' && pointer.reason === 'html-body-not-pointer')
    return { ...pointer, browser: review,
      reason: 'Browser rendered text on an HTML page; retained bytes are not a structured pointer.' };
  if (review.status === 'retrieved') return { ...common, state: 'retrieved-facility-match-unresolved' };
  if (review.status === 'challenge' || review.status === 'http-denied') return { ...common, state: 'access-denied-or-rate-limited-to-client' };
  if (review.status === 'browser-client-blocked' || review.status === 'navigation-failed') return { ...common, state: 'request-or-tool-failure' };
  return { ...common, state: 'not-retrieved-from-checked-locations' };
}

function disposition(row, pointer, selected, mrfReview = null, currentPointerLinksSelected = false, now = Date.now()) {
  if (row.finding === 'not-applicable-federal') return ['scope-exempt-federal', 'Federal facility; retain scope exclusion unless the project scope changes.'];
  if (row.finding === 'not-applicable-indian-health-program') return ['scope-exempt-indian-health-program', 'Current evidence identifies an Indian Health Program-operated hospital; retain the 45 CFR 180.30(b)(2) scope classification unless operator or program status changes.'];
  if (row.finding === 'not-applicable-state-hospital') return ['scope-exempt-state-hospital', 'Current exact-facility state-hospital evidence supports the federal deemed-compliant scope classification under 45 CFR 180.30(b); revisit if the CCN, operator, or legal status changes.'];
  if (row.finding === 'not-applicable-closed') return ['scope-exempt-closed', 'Hospital closure is supported by dated official evidence; recheck only if hospital operations resume.'];
  if (selected.best && pointer.corpus_raw_integrity === 'hash-corroborated'
      && pointer.corpus_sha256 && !currentPointerLinksSelected
      && !split(selected.best.pointer_sha256s).includes(pointer.corpus_sha256)) {
    return ['selected-file-only-in-earlier-pointer-version',
      'The identity-matched file is supported by an earlier pointer version, not the latest retained root bytes. Check the latest pointer-declared target and publisher page independently; retain the older file as dated evidence.'];
  }
  if (selected.best) {
    const state = metadataState(selected.best, now);
    if (state === 'verified-current-v3') return ['verified-current-mrf', 'No discovery follow-up; recheck on the next scheduled crawl.'];
    if (state === 'verified-stale-date') return ['verified-stale-mrf', 'Recheck this exact pointer-linked file after a publisher update or material source change; do not infer a legal violation from the stale date alone.'];
    if (state === 'verified-older-or-unresolved-template') return ['verified-template-review', 'Inspect the declared CMS template version and recheck after publisher update.'];
    return ['verified-facility-metadata-unresolved', 'Complete a bounded/full metadata read for the matched file.'];
  }
  if (mrfReview?.status === 'retrieved' && mrfReview.identity === 'unresolved')
    return ['mrf-facility-identity-unresolved', 'Resolve the page-linked file scope and exact CCN attribution before promotion.'];
  if (selected.review.length) return ['mrf-facility-identity-unresolved', 'Compare file header identity and address against this CCN and competing facilities.'];
  if (selected.linked.length) {
    if (mrfReview?.identity === 'conflicting') {
      return ['mrf-facility-identity-unresolved', 'Resolve the reviewed facility-identity conflict before retaining or replacing this MRF assignment.'];
    }
    if (mrfReview?.status === 'retrieved' && mrfReview.identity === 'corroborated') {
      const state = browserMetadataState(mrfReview, now);
      if (state === 'verified-current-v3') return ['verified-current-mrf', 'No discovery follow-up; recheck on the next scheduled crawl.'];
      if (state === 'verified-stale-date') return ['verified-stale-mrf', 'Recheck this exact pointer-linked file after a publisher update or material source change; do not infer a legal violation from the stale date alone.'];
      if (state === 'verified-older-or-unresolved-template') return ['verified-template-review', 'Inspect the declared CMS template version and recheck after publisher update.'];
      return ['verified-facility-metadata-unresolved', 'Complete a bounded/full metadata read for the browser-retrieved file.'];
    }
    if (mrfReview?.status === 'retrieved') return ['mrf-verification-pending', 'Parse and reconcile the browser-retrieved file identity and declared metadata.'];
    // Header identity can only be adjudicated from a successful bounded body
    // response. A HEAD 200 followed by a failed/empty range transfer contains
    // no file header and must remain a transport outcome, not an unmatched
    // facility assertion.
    const statuses = selected.linked.map(item => Number(item.mrf_range_status || 0));
    if (statuses.some(status => status >= 200 && status < 300)) {
      const matchedDifferentFacility = selected.linked.some(item => {
        const matchedCcns = split(item.header_matched_ccns);
        return matchedCcns.length && !matchedCcns.includes(row.ccn);
      });
      return ['linked-mrf-header-unmatched', matchedDifferentFacility
        ? 'Returned file matched a different CCN/facility; correct the pointer or file assignment before replacing standing evidence.'
        : 'Resolve the returned file identity before retaining or replacing the assignment.'];
    }
    return ['mrf-request-unsuccessful', 'Retry the exact pointer-declared MRF in a browser/download-capable client.'];
  }
  if (pointer.state === 'retrieved-facility-linked-manual-review') return ['pointer-linked-file-review-pending', 'Reconcile the reviewed pointer-linked file before a current-file finding.'];
  if (pointer.state === 'retrieved-facility-match-unresolved') return ['pointer-facility-match-unresolved', 'Reconcile every pointer entry using facility aliases and address evidence.'];
  if (pointer.state === 'retrieved-facility-linked') return ['pointer-linked-file-not-probed', 'Probe the pointer-linked file and reconcile its facility header.'];
  if (pointer.state === 'access-denied-or-rate-limited-to-client') return ['pointer-access-denied-to-client', 'Compare the exact URL in an interactive browser.'];
  if (pointer.state === 'request-or-tool-failure') return ['pointer-discovery-incomplete', 'Retry with an alternate client and interactive browser.'];
  if (!row.domain && row.website_review === 'candidate') return ['candidate-website-identity-unverified', 'Resolve the candidate against first-party facility name and address evidence.'];
  if (!row.domain && row.website_review === 'completed-no-official') return ['official-website-not-identified-completed-search', 'Recheck current legal/operator and historical facility names during the next discovery cycle.'];
  if (!row.domain) return ['official-website-search-pending', 'Search current and historical facility/operator names; require first-party name and address evidence.'];
  return ['pointer-not-retrieved', 'Inspect the official pricing page and recheck permitted pointer locations later.'];
}

function main(outputDir = AUDIT) {
  outputDir = path.resolve(outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(PRIVATE, { recursive: true });
  // This script produces the nationwide overlay. Do not consume a previous
  // copy while rebuilding it or prior_finding will recursively describe the
  // overlay instead of the reviewed crawl beneath it.
  const view = loadReviewedView(AUDIT, { nationwide: false });
  const headers = csvToObjects(fs.readFileSync(path.join(PRIVATE, 'mrf-headers.csv'), 'utf8'));
  const corpus = csvToObjects(fs.readFileSync(path.join(POINTER_DIR, 'cms_hpt_entries.csv'), 'utf8'));
  const state = JSON.parse(fs.readFileSync(path.join(POINTER_DIR, 'crawl-state.json'), 'utf8'));
  const discoveryFile = path.join(AUDIT, 'discovery-review.json');
  const discoveryRecords = fs.existsSync(discoveryFile) ? JSON.parse(fs.readFileSync(discoveryFile, 'utf8')).records || [] : [];
  const discoveryByCcn = new Map(discoveryRecords.map(record => [record.ccn, record]));
  const nationwideSearchFile = path.join(AUDIT, 'nationwide-search-reviews.json');
  const nationwideSearchRecords = fs.existsSync(nationwideSearchFile) ? JSON.parse(fs.readFileSync(nationwideSearchFile, 'utf8')).records || [] : [];
  const nationwideSearchByCcn = new Map(nationwideSearchRecords.map(record => [record.ccn, record]));
  const browserFile = path.join(AUDIT, 'nationwide-browser-reviews.json');
  const browserRecords = fs.existsSync(browserFile) ? JSON.parse(fs.readFileSync(browserFile, 'utf8')).records || [] : [];
  // Manual pointer rechecks are dated, hash-bound observations that may be
  // newer than the retained crawl. Keep them as explicit unresolved overlay
  // evidence when the crawl has the pointer but no machine-readable header
  // row; never turn them into a verified-current claim automatically.
  const manualObservationFile = path.join(AUDIT, 'reconciliation-manual-access-observations.json');
  const manualObservations = fs.existsSync(manualObservationFile)
    ? JSON.parse(fs.readFileSync(manualObservationFile, 'utf8')).records || [] : [];
  const omhObservationFile = path.join(AUDIT, 'reconciliation-omh-unreviewed-cohort-proof.json');
  const uhsDirectFileProofFile = path.join(AUDIT, 'reconciliation-uhs-direct-file-proof.json');
  // UHS direct-file proofs are deliberately separate from the manual-access
  // ledger because their exact first-party pointer routes were challenged.
  // Bring their bounded, identity-matched file metadata into the overlay as
  // file-only evidence, while retaining an unresolved disposition until
  // pointer linkage is independently recovered. This prevents a newer
  // pointer challenge from erasing stronger dated file evidence.
  const uhsDirectFileObservations = fs.existsSync(uhsDirectFileProofFile)
    ? (JSON.parse(fs.readFileSync(uhsDirectFileProofFile, 'utf8')).records || []).map(record => ({
      ccn: record.ccn,
      observed_at: record.observed_at,
      proof_file: 'reconciliation-uhs-direct-file-proof.json',
      pointer_url: record.pointer_url || '',
      pointer_status: record.pointer_browser_status || '',
      facility_file_url: record.mrf_url || '',
      file_bytes: record.bytes || 0,
      file_sha256: record.sha256 || '',
      declared_hospital_name: record.declared_hospital_name || '',
      declared_address: record.declared_address || '',
      declared_license_state: record.declared_state || '',
      declared_last_updated: record.declared_date || '',
      cms_template_version: record.version || '',
      manual_identity_gate: 'reviewed-file-address-equivalence',
      disposition: 'official-website-not-identified-completed-search',
      interpretation: 'Direct file bytes and header identity are retained separately from the challenged first-party pointer; exact pointer linkage remains unresolved.',
      next_action: 'Recover the exact first-party cms-hpt.txt pointer through a permitted route, then compare its declared MRF URL to the retained file before promotion.'
    })) : [];
  const overlayManualObservations = manualObservations.concat(uhsDirectFileObservations,
    fs.existsSync(omhObservationFile) ? JSON.parse(fs.readFileSync(omhObservationFile, 'utf8')).records || [] : []);
  // Multiple overlays can describe the same CCN (for example, an older
  // cohort quarantine plus a later hash-bound manual proof). Resolve the
  // newest observation first, then apply conflict handling only if that newest
  // observation is itself a conflict. Otherwise stale uncertainty can
  // override a later supported promotion. Older records remain in history.
  const latestManualObservationByCcn = new Map();
  for (const record of overlayManualObservations) {
    const prior = latestManualObservationByCcn.get(record.ccn);
    if (!prior || String(record.observed_at || '') > String(prior.observed_at || '')) {
      latestManualObservationByCcn.set(record.ccn, record);
    }
  }
  const manualConflictObservations = new Map([...latestManualObservationByCcn.entries()]
    .filter(([, record]) => record.reviewed_facility_mismatch === true
      || /license-state-conflict|address-(?:variant|conflict)|address-field-conflict|pointer-facility-match-unresolved|named-pointer-entry-shares|not-named-in-retained-root/i
      .test(`${record.disposition || ''} ${record.interpretation || ''}`)));
  const manualPointerRechecks = new Map();
  const manualUnassignedPointerRechecks = new Map();
  const manualPageFileRechecks = new Map();
  const manualAlternateFiles = new Map();
  for (const record of overlayManualObservations) {
    // Some reviewed observations predate the pointer-recheck shape but still
    // contain a complete official-page -> file -> header proof chain. Convert
    // only those records with bounded bytes, a digest, explicit file-level
    // identity metadata, and a file-header identity gate. This keeps page-
    // linked evidence separate from root-pointer evidence while preventing a
    // valid manual proof from being dropped by the nationwide overlay.
    const pageFileRecheck = manualPageFileRecheck(record);
    const priorPageFileRecheck = manualPageFileRechecks.get(record.ccn);
    if (pageFileRecheck && (!priorPageFileRecheck
      || String(pageFileRecheck.observed_at || '') > String(priorPageFileRecheck.observed_at || ''))) {
      manualPageFileRechecks.set(record.ccn, pageFileRecheck);
    }
    if (record.reviewed_facility_mismatch === true && record.ccn === '050348') continue;
    const unassignedPointerRecheck = record.latest_unassigned_pointer_recheck || {};
    const unassignedPointerRange = /^bytes\s+0-(\d+)\/(\d+)$/i.exec(String(unassignedPointerRecheck.content_range || ''));
    if (record.disposition === 'shared-root-pointer-rechecked-other-facility-file-excluded'
        && String(record.pointer_entry_attribution || '') !== String(record.ccn)
        && unassignedPointerRecheck.only_entry_ccn
        && String(unassignedPointerRecheck.only_entry_ccn) === String(record.pointer_entry_attribution || '')
        && unassignedPointerRecheck.same_hash_as_prior_pointer_corpus_capture === true
        && Number(unassignedPointerRecheck.http_status) === 206
        && Number.isInteger(Number(unassignedPointerRecheck.bytes))
        && Number(unassignedPointerRecheck.bytes) > 0 && !!unassignedPointerRange
        && Number(unassignedPointerRange[1]) + 1 === Number(unassignedPointerRecheck.bytes)
        && Number(unassignedPointerRange[2]) === Number(unassignedPointerRecheck.bytes)
        && /^[a-f0-9]{64}$/i.test(String(unassignedPointerRecheck.sha256 || ''))
        && unassignedPointerRecheck.sha256 === record.pointer_sha256
        && unassignedPointerRecheck.pointer_url === record.pointer_url
        && Number.isFinite(Date.parse(unassignedPointerRecheck.observed_at))) {
      manualUnassignedPointerRechecks.set(record.ccn, { ...unassignedPointerRecheck,
        ccn: record.ccn, attributed_entry_ccn: String(record.pointer_entry_attribution) });
    }
    if (record.alternate_pricing_file_proof) manualAlternateFiles.set(record.ccn, {
      proof: record.alternate_pricing_file_proof,
      name: record.alternate_pricing_file_name || '',
      bytes: Number(record.alternate_pricing_file_bytes) || 0,
      sha256: record.alternate_pricing_file_sha256 || '',
      status: Number(record.alternate_pricing_file_status) || 0,
      hospital_name: record.alternate_pricing_file_declared_hospital_name || '',
      address: record.alternate_pricing_file_declared_address || '',
      license_state: record.alternate_pricing_file_declared_license_state || '',
      date: record.alternate_pricing_file_declared_last_updated || '',
      version: record.alternate_pricing_file_cms_template_version || '',
      npi: record.alternate_pricing_file_declared_npi || '',
      attestation: record.alternate_pricing_file_attestation === true,
      usable_rows: record.alternate_pricing_file_usable_rows === true,
      next_action: record.next_action || ''
    });
    const latestPointerRecheck = record.latest_pointer_recheck || {};
    const latestPointerStatus = Number(latestPointerRecheck.pointer_http_status) || 0;
    const pointerRange = /^bytes\s+0-(\d+)\/(\d+)$/i.exec(String(latestPointerRecheck.pointer_content_range || ''));
    const completeBoundedPointer = latestPointerStatus === 206
      && Number.isInteger(Number(latestPointerRecheck.pointer_bytes))
      && Number(latestPointerRecheck.pointer_bytes) > 0
      && !!pointerRange
      && Number(pointerRange[1]) + 1 === Number(latestPointerRecheck.pointer_bytes)
      && Number(pointerRange[2]) === Number(latestPointerRecheck.pointer_bytes)
      && /^[a-f0-9]{64}$/i.test(String(latestPointerRecheck.pointer_sha256 || ''));
    if (latestPointerStatus === 200 || completeBoundedPointer) {
      // Accept a 206 pointer only when its retained range is the complete
      // document and is hash-bound. Partial pointer ranges remain evidence of
      // retrieval, but cannot establish the full pointer-to-file relationship.
      const latest = record.latest_successful_bounded_retrieval || {};
      manualPointerRechecks.set(record.ccn, {
        ...latestPointerRecheck,
        ccn: record.ccn,
        declared_last_updated: record.latest_pointer_recheck.declared_last_updated || latest.declared_last_updated || '',
        cms_template_version: record.latest_pointer_recheck.cms_template_version || latest.cms_template_version || '',
        declared_hospital_name: record.latest_pointer_recheck.declared_hospital_name || latest.declared_hospital_name || '',
        declared_location_name: record.latest_pointer_recheck.declared_location_name || latest.declared_location_name || '',
        declared_address: record.latest_pointer_recheck.declared_address || latest.declared_address || '',
        declared_license_state: record.latest_pointer_recheck.declared_license_state || latest.declared_license_state || '',
        declared_npi: record.latest_pointer_recheck.declared_npi || latest.declared_npi || ''
      });
      continue;
    }
    // Some dated manual proofs retain a successful root-pointer -> exact file
    // chain while deliberately withholding CMS metadata that the file does
    // not declare. Import that chain as review-pending; absent fields stay
    // absent and this branch can never establish CMS usability.
    if (record.current_root_pointer_http_status === 200
      && record.current_root_pointer_url && record.current_root_pointer_mrf_url
      && record.current_page_file_url === record.current_root_pointer_mrf_url
      && Number(record.current_page_file_http_status) === 200
      && Number(record.current_page_file_total_bytes) > 0
      && /^[a-f0-9]{64}$/i.test(record.current_page_file_sha256 || '')
      && record.current_page_file_header_name) {
      manualPointerRechecks.set(record.ccn, {
        ccn: record.ccn, observed_at: record.observed_at,
        pointer_url: record.current_root_pointer_url,
        pointer_sha256: record.current_root_pointer_sha256 || '',
        pointer_http_status: 200,
        pointer_declared_mrf_url: record.current_root_pointer_mrf_url,
        pointer_declared_location_name: record.current_page_file_header_name,
        exact_pointer_mrf_status: 200,
        file_sample_bytes: Number(record.current_page_file_total_bytes),
        file_sample_sha256: record.current_page_file_sha256,
        file_kind: record.current_page_file_content_type || 'csv',
        declared_hospital_name: record.current_page_file_header_name,
        declared_location_name: record.current_page_file_header_name,
        declared_last_updated: record.current_page_file_report_date || '',
        declared_address: '', declared_license_state: '', cms_template_version: '',
        manual_identity_gate: 'pointer-linked-file-name-only-metadata-limited',
        manual_disposition: 'pointer-linked-file-review-pending',
        next_action: record.next_action || '', manual_file_only: false
      });
      continue;
    }
    // Newer manual observations use the same explicit fields as the proof
    // ledger. Consume them generically so a hash-bound pointer/file review is
    // visible in nationwide verification instead of leaving the older crawl
    // row as if no evidence had been recovered. Missing fields remain empty;
    // this overlay never fabricates identity or CMS metadata.
    // A facility_file_url paired with a pricing page is page-linked evidence,
    // not a root-pointer recheck. Only treat the generic shape as a pointer
    // observation when pointer_url is a pointer document (or is absent).
    const pageSourceUrl = record.official_pricing_page || record.official_page_url || record.source_page_url || '';
    const freshnessRecheck = record.latest_file_freshness_recheck || null;
    const pointerDocument = !!record.pointer_url
      && /(?:^|\/)[^/]+\.txt(?:$|[?#])/i.test(String(record.pointer_url));
    if (pointerDocument && record.facility_file_url
      && record.declared_hospital_name && record.declared_address
      && record.declared_license_state && record.declared_last_updated
      && record.cms_template_version) {
      manualPointerRechecks.set(record.ccn, {
        ccn: record.ccn,
        observed_at: freshnessRecheck?.observed_at || record.observed_at,
        pointer_observed_at: freshnessRecheck?.pointer_observation_at || record.observed_at,
        pointer_url: record.pointer_url || '',
        pointer_sha256: record.pointer_sha256 || '',
        pointer_http_status: record.pointer_status || '',
        pointer_declared_mrf_url: freshnessRecheck?.mrf_url || record.facility_file_url,
        pointer_declared_location_name: record.declared_hospital_name,
        exact_pointer_mrf_status: freshnessRecheck?.mrf_http_status || record.file_range_status || record.mrf_status || '',
        file_kind: ['json', 'application/json'].includes(record.file_kind) ? 'json' : 'csv',
        complete_file_validated: completeFullFileObservation(record),
        file_range_status: Number(record.file_range_status) || 0,
        file_bytes: Number(record.file_bytes) || 0,
        full_file_bytes: Number(record.full_file_bytes) || 0,
        full_file_sha256: record.full_file_sha256 || '',
        file_sha256: record.file_sha256 || '',
        parsed_data_rows: Number(record.parsed_data_rows) || 0,
        csv_header_columns: Number(record.csv_header_columns) || 0,
        csv_data_row_widths: record.csv_data_row_widths || [],
        json_schema_version: record.json_schema_version || '',
        json_data_rows: Number(record.json_data_rows) || 0,
        json_usable_charge_rows: Number(record.json_usable_charge_rows) || 0,
        cms_validator: record.cms_validator || null,
        file_sample_bytes: freshnessRecheck?.file_sample_bytes || record.file_sample_bytes || 0,
        file_sample_sha256: freshnessRecheck?.file_sample_sha256 || record.file_sample_sha256 || '',
        declared_hospital_name: freshnessRecheck?.declared_hospital_name || record.declared_hospital_name,
        declared_location_name: freshnessRecheck?.declared_location_name || record.declared_location_name || record.declared_hospital_name,
        declared_address: freshnessRecheck?.declared_address || record.declared_address,
        declared_license_state: freshnessRecheck?.declared_license_state || record.declared_license_state,
        declared_last_updated: freshnessRecheck?.declared_last_updated || record.declared_last_updated,
        cms_template_version: freshnessRecheck?.cms_template_version || record.cms_template_version,
        attestation: record.attestation === true,
        declared_npi: record.declared_npi || '',
        manual_identity_gate: record.manual_identity_gate || '',
        manual_disposition: freshnessRecheck?.disposition || record.disposition || '',
        next_action: freshnessRecheck?.next_action || record.next_action || '',
        manual_file_only: ![200, 206].includes(Number(record.pointer_status))
      });
    }
    // A current official-page -> MRF proof without a root-pointer observation
    // is still useful exact-CCN evidence. Keep it explicitly file-only so it
    // cannot upgrade pointer provenance or imply full-file validation.
    if (record.page_only_provenance === true && !pointerDocument && pageSourceUrl && record.facility_file_url
      && record.declared_hospital_name && record.declared_location_name
      && record.declared_address && record.declared_license_state
      && record.declared_last_updated && record.cms_template_version
      && Number(record.facility_file_status) === 206
      && Number(record.official_pricing_page_status) === 200
      && Number(record.facility_file_sample_bytes) >= 65536
      && /^[a-f0-9]{64}$/i.test(String(record.facility_file_sample_sha256 || ''))
      && /file-header|file-name-address|complete-file-identity/i.test(String(record.manual_identity_gate || ''))
      && record.manual_disposition === 'verified-template-review') {
      manualPointerRechecks.set(record.ccn, {
        ccn: record.ccn,
        observed_at: record.observed_at,
        source_page_url: pageSourceUrl,
        pointer_url: record.pointer_url || '',
        pointer_http_status: record.pointer_status || '',
        pointer_declared_mrf_url: record.facility_file_url,
        exact_pointer_mrf_status: record.facility_file_status,
        file_bytes: Number(record.facility_file_sample_bytes),
        file_sha256: record.facility_file_sample_sha256,
        file_kind: record.facility_file_content_type || 'text/csv',
        declared_hospital_name: record.declared_hospital_name,
        declared_location_name: record.declared_location_name,
        declared_address: record.declared_address,
        declared_license_state: record.declared_license_state,
        declared_last_updated: record.declared_last_updated,
        cms_template_version: record.cms_template_version,
        declared_npi: record.declared_npi || '',
        manual_identity_gate: record.manual_identity_gate,
        manual_identity: record.manual_identity || 'corroborated',
        manual_disposition: record.manual_disposition,
        manual_file_only: true,
        page_only_provenance: true,
        next_action: record.next_action || ''
      });
    }
  }
  const roster = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, 'cms_data/hpt/roster.json'), 'utf8')).map(row => [row.ccn, row]));
  const reviewedExclusions = JSON.parse(fs.readFileSync(path.join(AUDIT, 'reviewed-file-attribution-exclusions.json'), 'utf8')).records;
  const exclusionByCcn = new Map();
  for (const exclusion of reviewedExclusions) {
    if (exclusionByCcn.has(exclusion.ccn)) throw new Error(`Duplicate reviewed file exclusion ${exclusion.ccn}`);
    const hospital = roster.get(exclusion.ccn);
    const header = headers.find(item => item.mrf_url === exclusion.excluded_mrf_url);
    const pointer = fs.readFileSync(path.join(ROOT, exclusion.current_pointer_file));
    const rejectedPointer = fs.readFileSync(path.join(ROOT, exclusion.excluded_pointer_file));
    if (hospital?.name !== exclusion.hospital_name || hospital.city !== exclusion.roster_city
      || hospital.state !== exclusion.roster_state || hospital.zip !== exclusion.roster_zip
      || !header || !split(header.review_ccns).includes(exclusion.ccn)
      || header.checked_at !== exclusion.excluded_header_checked_at
      || header.pointer_sha256s !== exclusion.excluded_header_pointer_sha256s
      || header.mrf_hospital_name !== exclusion.excluded_header_hospital_name
      || header.mrf_location_name !== exclusion.excluded_header_location_name
      || header.mrf_address !== exclusion.excluded_header_address
      || header.mrf_license_state !== exclusion.excluded_header_license_state
      || crypto.createHash('sha256').update(pointer).digest('hex') !== exclusion.current_pointer_sha256
      || crypto.createHash('sha256').update(rejectedPointer).digest('hex') !== exclusion.excluded_pointer_sha256
      || !pointer.toString().includes(`location-name: ${exclusion.current_pointer_location_name}`)
      || (pointer.toString().match(/^mrf-url:\s*(.+)$/gm) || []).length !== 1
      || crypto.createHash('sha256').update((pointer.toString().match(/^mrf-url:\s*(.+)$/m) || [,''])[1].trim()).digest('hex')
        !== exclusion.current_pointer_mrf_url_sha256
      || !rejectedPointer.toString().includes(exclusion.excluded_mrf_url))
      throw new Error(`Reviewed file attribution exclusion source changed for ${exclusion.ccn}`);
    exclusionByCcn.set(exclusion.ccn, exclusion);
  }
  const addressReviews = new Map(JSON.parse(fs.readFileSync(path.join(AUDIT, 'reviewed-address-equivalences.json'), 'utf8')).records.map(row => [row.ccn, row]));
  const browserPointerByUrl = new Map(browserRecords.filter(record => record.kind === 'pointer').map(record => [normalizeUrl(record.target), record]));
  const browserMrfByUrl = new Map(browserRecords.filter(record => record.kind === 'mrf').map(record => [normalizeUrl(record.target), record]));
  const targetIndexes = buildTargetIndexes(state);
  const resolutionFile = path.join(AUDIT, 'reviewed-resolutions.json');
  const resolutions = fs.existsSync(resolutionFile) ? JSON.parse(fs.readFileSync(resolutionFile, 'utf8')) : [];
  const resolutionByCcn = new Map(resolutions.map(record => [record.ccn, record]));
  const appliedResolutions = new Set(view.applied || []);
  const headerByCcn = new Map(), corpusByCcn = new Map();
  const invalidatedHtmlHashes = new Set(Object.values(state.targets || {})
    .filter(target => target.status === 'invalid' && target.reason === 'html-body-not-pointer')
    .map(target => target.sha256).filter(Boolean));
  const invalidatedHeadersByCcn = new Map();
  const pointerFilePairs = new Set(corpus.filter(entry => entry.record_status === 'ok')
    .map(entry => `${entry.pointer_sha256}\0${normalizeUrl(entry.mrf_url)}`));
  for (const header of headers) for (const ccn of new Set([
    ...split(header.header_matched_ccns), ...split(header.review_ccns), ...split(header.existing_matched_ccns)
  ])) {
    const hashes = split(header.pointer_sha256s);
    add(hashes.length && hashes.every(hash => invalidatedHtmlHashes.has(hash))
      ? invalidatedHeadersByCcn : headerByCcn, ccn, header);
  }
  for (const entry of corpus) for (const ccn of split(entry.matched_ccns)) add(corpusByCcn, ccn, entry);
  const snapshotTime = Date.now();
  const generated_at = new Date(snapshotTime).toISOString();
  const records = view.compliance.map(row => {
    const siteCorrection = appliedResolutions.has(row.ccn) && resolutionByCcn.get(row.ccn)?.action === 'correct-site'
      ? resolutionByCcn.get(row.ccn) : null;
    const discovery = discoveryByCcn.get(row.ccn);
    const searchReview = nationwideSearchByCcn.get(row.ccn);
    const manualIdentityObservation = latestManualObservationByCcn.get(row.ccn);
    const manualDomain = [
      manualIdentityObservation?.current_operator_domain,
      manualIdentityObservation?.current_operator_domain_lead,
      manualIdentityObservation?.current_official_domain,
      manualIdentityObservation?.official_hospital_domain,
      manualIdentityObservation?.official_domain,
      manualIdentityObservation?.official_site
    ].map(hostnameFromUrl).find(Boolean) || '';
    const reviewedDomain = manualDomain
      || (searchReview?.status === 'official' ? hostnameFromUrl(searchReview.domain) : '')
      || (discovery?.website?.identity === 'corroborated' ? hostnameFromUrl(discovery.website.domain) : '');
    const websiteReview = searchReview?.status === 'candidate' ? 'candidate'
      : searchReview?.status === 'completed-no-official' ? 'completed-no-official'
        : discovery?.website?.identity === 'unverified' || discovery?.website?.plausible ? 'candidate'
          : discovery?.disposition === 'search-completed-no-official' && !manualDomain ? 'completed-no-official' : '';
    const effective = { ...row, domain: row.domain || reviewedDomain, website_review: websiteReview };
    // A corrected hospital domain cannot inherit a sibling hospital's old
    // pointer or MRF merely because its pointer once named this facility.
    const exclusion = exclusionByCcn.get(row.ccn);
    const sourceHeaders = headerByCcn.get(row.ccn) || [];
    const selected = choose(siteCorrection ? [] : exclusion
      ? sourceHeaders.filter(header => header.mrf_url !== exclusion.excluded_mrf_url) : sourceHeaders,
    row.ccn, row.hospital_name, snapshotTime);
    const best = selected.best;
    const manualPointerRecheck = manualPointerRechecks.get(row.ccn) || manualPageFileRechecks.get(row.ccn);
    const manualAlternateFile = manualAlternateFiles.get(row.ccn);
    const manualObservation = latestManualObservationByCcn.get(row.ccn);
    // Retain the separately observed file header, but never treat a file
    // harvested from HTML metadata as pointer-declared evidence.
    const invalidatedHeader = (invalidatedHeadersByCcn.get(row.ccn) || [])[0] || null;
    const candidate = best || selected.review[0] || selected.linked[0] || invalidatedHeader;
    let pointer = manualPointerRecheck && !manualPointerRecheck.manual_file_only ? {
      state: 'retrieved-facility-linked-manual-review',
      observed_at: manualPointerRecheck.pointer_observed_at || manualPointerRecheck.observed_at,
      result: String(manualPointerRecheck.pointer_http_status),
      reason: [200, 206].includes(Number(manualPointerRecheck.exact_pointer_mrf_status))
        && manualPointerRecheck.complete_file_validated
          ? 'Dated manual evidence links the current structured pointer to a completely retrieved and structurally validated MRF; tracker disposition is independently reviewer-adjudicated'
        : Number(manualPointerRecheck.exact_pointer_mrf_status) >= 200
          && Number(manualPointerRecheck.exact_pointer_mrf_status) < 300
          ? 'The exact pointer-declared MRF returned a bounded successful response; full-file validation is not implied'
          : 'A dated manual recheck retrieved the current structured pointer; the exact declared MRF route remains transport-unresolved',
      corpus_checked_url: manualPointerRecheck.pointer_url,
      corpus_final_url: manualPointerRecheck.pointer_url,
      corpus_sha256: manualPointerRecheck.pointer_sha256,
      corpus_observed_at: manualPointerRecheck.pointer_observed_at || manualPointerRecheck.observed_at,
      corpus_raw_integrity: 'manual-hash-bound',
      browser: null
    } : siteCorrection ? {
      state: siteCorrection.evidence.rootPointerResponseKind === 'structured-facility-pointer'
        ? 'retrieved-facility-linked-manual-review' : 'not-retrieved-from-checked-locations',
      observed_at: siteCorrection.evidence.checked_at,
      result: String(siteCorrection.evidence.rootPointerHttpStatus),
      reason: siteCorrection.evidence.rootPointerResponseKind === 'html-security-challenge'
        ? 'Current hospital-domain root pointer returned an HTML security challenge to this client'
        : siteCorrection.evidence.rootPointerResponseKind === 'structured-facility-pointer'
          ? 'Reviewed current hospital-domain root pointer names this facility and links a bounded-header file; complete file and page-link relationship remain unresolved'
        : 'Current hospital-domain root pointer returned HTTP ' + siteCorrection.evidence.rootPointerHttpStatus
    } : applyBrowserPointerObservation(
      indexedPointerObservation(effective, targetIndexes, corpusByCcn.get(row.ccn) || [], best?.mrf_url || ''), effective, browserPointerByUrl);
    const manualPointerChallenge = manualObservation?.latest_pointer_challenge_recheck
      || Object.entries(manualObservation || {}).find(([key, value]) => /^latest_pointer_challenge_recheck/.test(key)
        && value && typeof value === 'object')?.[1];
    const manualChallengePointerUrl = manualObservation?.pointer_url
      || (manualDomain ? `https://${manualDomain}/cms-hpt.txt` : '');
    if (manualPointerChallenge?.pointer_status && manualChallengePointerUrl) {
      pointer = {
        ...pointer,
        state: Number(manualPointerChallenge.pointer_status) >= 400
          ? 'access-denied-or-rate-limited-to-client' : pointer.state,
        observed_at: manualPointerChallenge.observed_at || pointer.observed_at,
        result: String(manualPointerChallenge.pointer_status),
        reason: manualPointerChallenge.result || manualPointerChallenge.disposition || pointer.reason,
        corpus_checked_url: manualChallengePointerUrl,
        corpus_final_url: manualChallengePointerUrl
      };
    }
    const candidateUnassignedPointerRecheck = manualUnassignedPointerRechecks.get(row.ccn);
    const currentUnassignedPointerRecheck = candidateUnassignedPointerRecheck
      && candidateUnassignedPointerRecheck.pointer_url === pointer.corpus_checked_url
      && candidateUnassignedPointerRecheck.sha256 === pointer.corpus_sha256
      ? candidateUnassignedPointerRecheck : null;
    const headerEvidence = headerEvidenceForSelection(selected, candidate, row.ccn);
    const manualMrfReview = manualPointerRecheck ? {
      status: 'retrieved', identity: manualPointerRecheck.manual_identity || 'corroborated',
      target: manualPointerRecheck.pointer_declared_mrf_url,
      declared_hospital_name: manualPointerRecheck.declared_hospital_name || manualPointerRecheck.pointer_declared_location_name,
      declared_location_name: manualPointerRecheck.declared_location_name || manualPointerRecheck.pointer_declared_location_name,
      declared_address: manualPointerRecheck.declared_address || '',
      declared_license_state: manualPointerRecheck.declared_license_state || '',
      declared_last_updated: manualPointerRecheck.declared_last_updated || '',
      cms_template_version: manualPointerRecheck.cms_template_version || '',
      observed_at: manualPointerRecheck.observed_at,
      identity_gate: manualPointerRecheck.manual_identity_gate || 'recorded-file-name-street-state-agree'
    } : null;
    const mrfReview = manualPointerRecheck?.manual_identity_gate
      ? { ...manualMrfReview, identity: manualPointerRecheck.manual_identity || 'corroborated', identity_gate: manualPointerRecheck.manual_identity_gate }
      : qualifyBrowserIdentity(browserMrfByUrl.get(normalizeUrl(candidate?.mrf_url || row.mrf_url || '')) || manualMrfReview, roster.get(row.ccn), addressReviews.get(row.ccn));
    const currentPointerLinksSelected = !!best && pointerFilePairs.has(
      `${pointer.corpus_sha256}\0${normalizeUrl(best.mrf_url)}`);
    const [computedLabel, genericNextAction] = disposition(effective, pointer, selected, mrfReview, currentPointerLinksSelected, snapshotTime);
    const unresolvedManualDispositions = ['pointer-linked-file-review-pending', 'pointer-linked-file-not-probed',
      'mrf-verification-pending', 'mrf-facility-identity-unresolved', 'file-custom-workbook-review'];
    const manualDisposition = manualPointerRecheck?.manual_disposition
      || (manualObservation?.disposition === 'verified-template-review' && !manualPointerRecheck
        && !row.mrf_url && !best?.mrf_url ? 'verified-template-review' : '')
      || (/custom[- ]workbook|chargemaster/i.test(String(manualObservation?.disposition || ''))
        && /unresolved|not[- ]treated|not[- ]a[- ]current/i.test(String(manualObservation?.disposition || ''))
        ? 'file-custom-workbook-review' : '')
      || (unresolvedManualDispositions.includes(manualObservation?.disposition) ? manualObservation.disposition : '');
    const reviewedFacilityMismatch = manualObservation?.reviewed_facility_mismatch === true
      && manualObservation.ccn === row.ccn && manualObservation.disposition === 'linked-mrf-header-unmatched';
    const label = reviewedFacilityMismatch || manualConflictObservations.has(row.ccn) ? 'linked-mrf-header-unmatched'
      : ['verified-template-review', 'verified-stale-mrf', 'verified-current-mrf',
      'verified-facility-metadata-unresolved', 'pointer-linked-file-review-pending',
      'pointer-linked-file-not-probed', 'mrf-verification-pending', 'mrf-facility-identity-unresolved',
      'file-custom-workbook-review'].includes(manualDisposition)
        ? manualDisposition : computedLabel;
    const next_action = exclusion ? exclusion.next_action
      : manualPointerRecheck?.next_action || (siteCorrection
        ? (siteCorrection.evidence.next_action || 'Verify the repaired hospital-domain root pointer and exact MRF target; separately review the current page-linked CSV template and date.')
      : reviewedFacilityMismatch ? manualObservation.next_action
        : manualObservation?.next_action || manualAlternateFile?.next_action || genericNextAction);
    const fileEvidence = reviewedFacilityMismatch ? {
      declared_hospital_name: manualObservation.declared_hospital_name,
      declared_location_name: manualObservation.declared_location_name,
      declared_address: manualObservation.declared_address,
      declared_license_state: manualObservation.declared_license_state,
      declared_last_updated: manualObservation.declared_last_updated,
      cms_template_version: manualObservation.cms_template_version,
      observed_at: manualObservation.observed_at,
      metadata_source: 'reviewed-identity-conflict',
      file_sample_bytes: manualObservation.facility_file_sample_bytes,
      file_sample_sha256: manualObservation.facility_file_sample_sha256,
      file_kind: 'json',
      source_page_url: manualObservation.source_page_url
    } : manualPointerRecheck ? {
      declared_hospital_name: manualPointerRecheck.declared_hospital_name || manualPointerRecheck.pointer_declared_location_name,
      declared_location_name: manualPointerRecheck.declared_location_name || manualPointerRecheck.pointer_declared_location_name,
      declared_address: manualPointerRecheck.declared_address || '',
      declared_license_state: manualPointerRecheck.declared_license_state || '',
      declared_last_updated: manualPointerRecheck.declared_last_updated || '',
      cms_template_version: manualPointerRecheck.cms_template_version || '', observed_at: manualPointerRecheck.observed_at,
      metadata_source: manualPointerRecheck.manual_file_only ? 'manual-page-file-recheck' : 'manual-pointer-recheck',
      ...(manualPointerRecheck.file_sample_bytes ? {
        file_sample_bytes: manualPointerRecheck.file_sample_bytes,
        file_sample_sha256: manualPointerRecheck.file_sample_sha256 || '',
        file_kind: manualPointerRecheck.file_kind || ''
      } : {}),
      ...(manualPointerRecheck.complete_file_validated ? {
        complete_file_validated: true,
        full_file_bytes: manualPointerRecheck.full_file_bytes,
        full_file_sha256: manualPointerRecheck.full_file_sha256,
        file_bytes: manualPointerRecheck.file_bytes,
        file_sha256: manualPointerRecheck.file_sha256,
        parsed_data_rows: manualPointerRecheck.parsed_data_rows,
        csv_header_columns: manualPointerRecheck.csv_header_columns,
        csv_data_row_widths: manualPointerRecheck.csv_data_row_widths,
        json_schema_version: manualPointerRecheck.json_schema_version || '',
        json_data_rows: Number(manualPointerRecheck.json_data_rows) || 0,
        json_usable_charge_rows: Number(manualPointerRecheck.json_usable_charge_rows) || 0,
        attestation: manualPointerRecheck.attestation === true,
        cms_validator: manualPointerRecheck.cms_validator
      } : {}),
      ...(manualPointerRecheck.manual_file_only ? {
        file_sample_bytes: manualPointerRecheck.file_bytes || 0,
        file_sample_sha256: manualPointerRecheck.file_sha256 || '',
        file_kind: manualPointerRecheck.file_kind || '',
        source_page_url: manualPointerRecheck.source_page_url || ''
      } : {}),
      ...(manualPointerRecheck.alternate_pricing_file_proof ? {
        alternate_pricing_file_proof: manualPointerRecheck.alternate_pricing_file_proof,
        alternate_pricing_file_name: manualPointerRecheck.alternate_pricing_file_name || '',
        alternate_pricing_file_bytes: Number(manualPointerRecheck.alternate_pricing_file_bytes) || 0,
        alternate_pricing_file_sha256: manualPointerRecheck.alternate_pricing_file_sha256 || '',
        alternate_pricing_file_status: Number(manualPointerRecheck.alternate_pricing_file_status) || 0,
        alternate_pricing_file_declared_hospital_name: manualPointerRecheck.alternate_pricing_file_declared_hospital_name || '',
        alternate_pricing_file_declared_address: manualPointerRecheck.alternate_pricing_file_declared_address || '',
        alternate_pricing_file_declared_license_state: manualPointerRecheck.alternate_pricing_file_declared_license_state || '',
        alternate_pricing_file_declared_last_updated: manualPointerRecheck.alternate_pricing_file_declared_last_updated || '',
        alternate_pricing_file_cms_template_version: manualPointerRecheck.alternate_pricing_file_cms_template_version || '',
        alternate_pricing_file_declared_npi: manualPointerRecheck.alternate_pricing_file_declared_npi || '',
        alternate_pricing_file_attestation: manualPointerRecheck.alternate_pricing_file_attestation === true,
        alternate_pricing_file_usable_rows: manualPointerRecheck.alternate_pricing_file_usable_rows === true
      } : {})
    } : selectedFileEvidence(selected, candidate, mrfReview);
    const record = { ccn: row.ccn, hospital_name: row.hospital_name, city: row.city, state: row.state, hospital_type: row.type,
      ...(reviewedFacilityMismatch ? { reviewed_facility_mismatch: true } : {}),
      prior_finding: row.finding, standing_finding: row.finding,
      reviewed_excluded_mrf_url: exclusion?.excluded_mrf_url || '',
      standing_pointer_url: row.pointer_url || '', standing_mrf_url: row.mrf_url || '',
      standing_additional_mrf_urls: appliedResolutions.has(row.ccn)
        && row.mrf_url === resolutionByCcn.get(row.ccn)?.evidence?.url
        ? (resolutionByCcn.get(row.ccn)?.evidence?.additionalFiles || []).map(file => file.url) : [],
      standing_checked_at: row.checked_at || '', official_domain: effective.domain || '',
      website_state: row.domain ? 'recorded-official-domain' : reviewedDomain ? 'reviewed-first-party-domain'
        : websiteReview === 'candidate' ? 'candidate-identity-unverified'
          : websiteReview === 'completed-no-official' ? 'not-identified-after-completed-search' : 'search-pending',
      website_name_evidence: searchReview?.name_evidence || discovery?.website?.name_evidence || '',
      website_address_evidence: searchReview?.address_evidence || discovery?.website?.address_evidence || '',
      website_observed_at: searchReview?.observed_at || discovery?.observed_at || '',
      // A hash-corroborated CCN-linked corpus pointer remains useful source
      // provenance even before its file header has been probed. Do not hide
      // that exact URL merely because the older crawl had no pointer_url.
      pointer_state: reviewedFacilityMismatch ? 'retrieved-facility-match-unresolved'
        : manualPointerRecheck?.page_only_provenance ? 'not-assessed-page-file-only'
        : pointer.state, pointer_url: reviewedFacilityMismatch ? manualObservation.pointer_url
          : siteCorrection?.evidence.rootPointerUrl || manualPointerRecheck?.pointer_url || candidate?.pointer_urls || row.pointer_url
        || manualObservation?.pointer_url
        || manualChallengePointerUrl
        || (pointer.state === 'retrieved-facility-linked' ? pointer.corpus_checked_url : ''),
      pointer_observed_at: currentUnassignedPointerRecheck?.observed_at || pointer.observed_at,
      pointer_result: manualPointerRecheck?.page_only_provenance ? ''
        : currentUnassignedPointerRecheck ? String(currentUnassignedPointerRecheck.http_status) : pointer.result,
      pointer_reason: manualPointerRecheck?.page_only_provenance
        ? 'Official pricing page links the reviewed file; current structured root-pointer linkage is not established.'
        : currentUnassignedPointerRecheck
          ? 'The complete root pointer was rechecked and its hash is unchanged; its only entry remains attributed to a different CCN.'
          : pointer.reason,
      pointer_corpus_checked_url: pointer.corpus_checked_url || '', pointer_corpus_final_url: pointer.corpus_final_url || '',
      pointer_corpus_sha256: pointer.corpus_sha256 || '', pointer_corpus_observed_at: pointer.corpus_observed_at || '',
      pointer_corpus_raw_integrity: pointer.corpus_raw_integrity || '',
      pointer_historical_checked_url: pointer.historical_checked_url || '',
      pointer_historical_final_url: pointer.historical_final_url || '',
      pointer_historical_sha256: pointer.historical_sha256 || '',
      pointer_historical_observed_at: pointer.historical_observed_at || '',
      pointer_historical_raw_integrity: pointer.historical_raw_integrity || '',
      browser_pointer_status: pointer.browser?.status || '', browser_pointer_observed_at: pointer.browser?.observed_at || '',
      browser_pointer_final_url: pointer.browser?.final_url || '',
      mrf_state: reviewedFacilityMismatch ? 'identity-review'
        : manualPointerRecheck ? (manualPointerRecheck.manual_file_only
        ? 'page-linked-file-retrieved' : [200, 206].includes(Number(manualPointerRecheck.exact_pointer_mrf_status))
          && manualPointerRecheck.complete_file_validated ? 'verified-current-v3'
          : Number(manualPointerRecheck.exact_pointer_mrf_status) >= 200
            && Number(manualPointerRecheck.exact_pointer_mrf_status) < 300 ? 'linked-file-retrieved-metadata-limited'
            : 'linked-file-transport-unresolved') : best ? metadataState(best, snapshotTime)
        : mrfReview?.status === 'retrieved' && mrfReview.identity === 'corroborated' ? browserMetadataState(mrfReview, snapshotTime)
          : selected.review.length ? 'identity-review' : selected.linked.length ? 'linked-unmatched-or-unreachable'
            : invalidatedHeader ? 'file-header-retained-pointer-unretrieved' : 'not-assessed',
      // A retained HTML-derived header may use a malformed/old URL. A later
      // guarded standing review supplies the authoritative page-linked URL.
      mrf_url: reviewedFacilityMismatch ? manualObservation.facility_file_url
        : manualPointerRecheck ? manualPointerRecheck.pointer_declared_mrf_url
        : invalidatedHeader === candidate && row.mrf_url
        ? row.mrf_url : candidate?.mrf_url || row.mrf_url || '',
      mrf_http_status: reviewedFacilityMismatch ? '206' : manualPointerRecheck ? String(manualPointerRecheck.exact_pointer_mrf_status)
        : candidate?.mrf_range_status || candidate?.mrf_http_status || '',
      browser_mrf_status: mrfReview?.status || '', browser_mrf_observed_at: mrfReview?.observed_at || '',
      browser_mrf_final_url: mrfReview?.final_url || '',
      browser_identity_gate: mrfReview?.identity_gate || '',
      header_identity_gate: headerEvidence.identity_gate,
      address_reconciliation: mrfReview?.address_review || null,
      facility_identity: reviewedFacilityMismatch ? 'identity-review-required'
        : best ? 'corroborated-by-pointer-and-header'
        : mrfReview?.identity === 'corroborated' ? 'corroborated-by-reviewed-browser-read'
          : mrfReview?.identity === 'conflicting' ? 'conflicting-reviewed-identity'
            : mrfReview?.identity === 'unresolved' ? 'identity-review-required'
            : selected.review.length ? 'review-required' : selected.linked.length ? 'not-corroborated' : 'not-assessed',
      ...fileEvidence,
      freshness_assessed_at: generated_at,
      declared_file_age_days: Number.isFinite(parseDeclaredDate(fileEvidence.declared_last_updated))
        ? Math.floor((snapshotTime - parseDeclaredDate(fileEvidence.declared_last_updated)) / 86400000) : null,
      ...(manualAlternateFile ? {
        alternate_pricing_file_proof: manualAlternateFile.proof,
        alternate_pricing_file_name: manualAlternateFile.name,
        alternate_pricing_file_bytes: manualAlternateFile.bytes,
        alternate_pricing_file_sha256: manualAlternateFile.sha256,
        alternate_pricing_file_status: manualAlternateFile.status,
        alternate_pricing_file_declared_hospital_name: manualAlternateFile.hospital_name,
        alternate_pricing_file_declared_address: manualAlternateFile.address,
        alternate_pricing_file_declared_license_state: manualAlternateFile.license_state,
        alternate_pricing_file_declared_last_updated: manualAlternateFile.date,
        alternate_pricing_file_cms_template_version: manualAlternateFile.version,
        alternate_pricing_file_declared_npi: manualAlternateFile.npi,
        alternate_pricing_file_attestation: manualAlternateFile.attestation,
        alternate_pricing_file_usable_rows: manualAlternateFile.usable_rows
      } : {}),
      ...(currentUnassignedPointerRecheck ? { pointer_recheck_observation: {
        observed_at: currentUnassignedPointerRecheck.observed_at,
        http_status: currentUnassignedPointerRecheck.http_status,
        final_url: currentUnassignedPointerRecheck.final_url,
        bytes: currentUnassignedPointerRecheck.bytes,
        content_range: currentUnassignedPointerRecheck.content_range,
        sha256: currentUnassignedPointerRecheck.sha256,
        only_entry_location_name: currentUnassignedPointerRecheck.only_entry_location_name,
        attributed_entry_ccn: currentUnassignedPointerRecheck.attributed_entry_ccn,
        same_hash_as_prior_pointer_corpus_capture: true
      } } : {}),
      observed_at: currentUnassignedPointerRecheck && label === 'pointer-facility-match-unresolved'
        ? currentUnassignedPointerRecheck.observed_at
        : label === 'selected-file-only-in-earlier-pointer-version'
        ? pointer.observed_at || fileEvidence.observed_at || ''
        : fileEvidence.observed_at || pointer.observed_at || '', disposition: label, next_action,
      evidence: { pointer_sha256s: invalidatedHeader === candidate ? [] : split(candidate?.pointer_sha256s || '').slice(0, 8),
        invalidated_html_sha256s: invalidatedHeader === candidate ? split(candidate?.pointer_sha256s || '').slice(0, 8) : [],
        pointer_location_names: split(candidate?.pointer_location_names || '').slice(0, 16),
        header_match_reason: headerEvidence.match_reason,
        matched_mrf_candidates: selected.matched.length, review_mrf_candidates: selected.review.length,
        linked_mrf_candidates: selected.linked.length }, report_generated_at: generated_at };
    const resolution = resolutionByCcn.get(row.ccn);
    const manualConflict = manualConflictObservations.get(row.ccn);
    const appliedResolutionAt = resolution?.action === 'replace-page-file-observation'
      ? [resolution.reviewed_at, resolution.evidence?.checked_at].filter(Boolean)
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0] : resolutionObservedAt(resolution);
    const laterPageFileReview = resolution?.action === 'replace-page-file-observation'
      && appliedResolutions.has(row.ccn) && Date.parse(appliedResolutionAt) > Date.parse(record.observed_at || '');
    // A later manual observation that explicitly documents a state, address,
    // or facility-identity conflict reopens the CCN for current verification;
    // an older applied resolution must not make that conflict disappear from
    // the nationwide overlay.
    const retainedStrongFinding = standingEvidenceRetained(record.prior_finding, record.disposition);
    const samePointerRetry = sameResolvedPointerRetry(resolution, record, appliedResolutions.has(row.ccn));
    const sameReviewedObservation = reviewedResolutionIsSameObservation(resolution, record,
      latestManualObservationByCcn.get(row.ccn), appliedResolutions.has(row.ccn));
    const newerRetryThanResolution = !samePointerRetry && retainedStrongFinding && record.observed_at
      && Date.parse(record.observed_at) > Date.parse(resolutionObservedAt(resolution));
    const superseded = !reviewedFacilityMismatch && !manualConflict && !laterPageFileReview && !newerRetryThanResolution
      && !sameReviewedObservation
      // The retained finding can itself be the reviewed resolution's result
      // (for example, a byte-backed license-state conflict). A later corpus
      // retry at an older timestamp must not supersede that reviewed evidence.
      && !(resolution?.action === 'replace-observation'
        && record.ccn === '260057'
        && resolution.evidence?.observedFinding === 'mrf-license-state-field-conflicts-facility'
        && resolution.evidence?.url === 'https://irp.cdn-website.com/87401228/files/uploaded/440668347_cameron-regional-medical-center_standardcharges-b094301b-664adbbd.csv'
        && record.mrf_url === 'https://www.cameronregional.org/440668347_cameron-regional-medical-center_standardcharges.csv'
        && record.disposition === 'linked-mrf-header-unmatched'
      )
      && (samePointerRetry || reviewedResolutionSupersedes(resolution, record.observed_at, appliedResolutions.has(row.ccn)));
    const retained = !manualConflict && !superseded && retainedStrongFinding;
    const supportedIdentity = !manualConflict && !superseded && isSupportedIdentityUncertainty(resolution)
      && record.prior_finding === 'not-assessed-identity-conflict';
    return { ...record,
      ...(manualConflict?.observed_at ? { observed_at: manualConflict.observed_at } : {}),
      observation_role: superseded ? 'superseded-retry' : retained ? 'incomplete-retry-standing-retained' : 'current-observation',
      latest_observation_superseded: superseded,
      standing_evidence_retained: retained,
      supported_identity_uncertainty: supportedIdentity,
      standing_evidence_reason: retained
        ? record.evidence.header_match_reason === 'linked-file-matched-different-facility'
          ? 'The newer linked-file header matches a different facility. The older standing claim is contested pending exact-CCN review; retention is not renewed verification.'
          : 'The newer observation does not by itself disprove the older dated finding. Retention is not renewed verification; investigate any unmatched facility header.'
        : '',
      superseding_resolution_observed_at: superseded ? resolutionObservedAt(resolution) : '',
      superseding_resolution_run: superseded ? resolution.evidence_run || resolution.evidence?.reconciliation_run || '' : '' };
  });
  if (records.length !== 5419 || new Set(records.map(row => row.ccn)).size !== 5419) throw new Error('Nationwide assessment must contain 5,419 unique CCNs');
  const counts = records.reduce((out, row) => ((out[row.disposition] = (out[row.disposition] || 0) + 1), out), {});
  const reviewedRecords = applyReviewedVerificationOverlays(records, AUDIT);
  const effective_counts = reviewedRecords.reduce((out, row) => {
    const category = effectiveDispositionCategory(row);
    out[category] = (out[category] || 0) + 1;
    return out;
  }, {});
  const source_observation_effective_counts = records.reduce((out, row) => {
    const category = effectiveDispositionCategory(row);
    out[category] = (out[category] || 0) + 1;
    return out;
  }, {});
  // Both public category summaries describe the effective reviewed rows;
  // retain the serialized retry-level dispositions in `records` themselves.
  const reviewed_view_effective_counts = reviewedRecords.reduce((out, row) => {
    const category = effectiveDispositionCategory(row);
    out[category] = (out[category] || 0) + 1;
    return out;
  }, {});
  const reviewedViewUnresolved = reviewedRecords.filter(row => !row.latest_observation_superseded
    && (!row.standing_evidence_retained || row.disposition === 'pointer-facility-match-unresolved')
    && !row.supported_identity_uncertainty
    && !/^verified-|^scope-exempt/.test(row.disposition)).length;
  const summary = { generated_at, hospitals: records.length, unique_ccns: new Set(records.map(row => row.ccn)).size,
    fresh_pointer_documents: state.summary.pointerDocuments, unique_pointer_declared_mrfs: headers.length,
    counts, effective_counts,
    source_observation_effective_counts,
    effective_counts_basis: 'Categories of the effective reviewed view; serialized retry-level observations and their roles remain available per CCN.',
    reviewed_view_effective_counts,
    reviewed_view_unresolved: reviewedViewUnresolved,
    verified_facility_mrfs: records.filter(row => row.facility_identity === 'corroborated-by-pointer-and-header').length,
    superseded_observations: records.filter(row => row.latest_observation_superseded).length,
    standing_evidence_retained_observations: records.filter(row => row.standing_evidence_retained).length,
    active_verification_claims: records.filter(row => !row.latest_observation_superseded && row.disposition.startsWith('verified-')).length,
    unresolved: records.filter(row => !row.latest_observation_superseded
      && (!row.standing_evidence_retained || row.disposition === 'pointer-facility-match-unresolved')
      && !row.supported_identity_uncertainty
      && !/^verified-|^scope-exempt/.test(row.disposition)).length };
  fs.writeFileSync(path.join(outputDir, 'nationwide-verification.json'), JSON.stringify({ summary, records }, null, 2) + '\n');
  const flat = records.map(({ evidence, ...row }) => ({ ...row,
    standing_additional_mrf_urls: row.standing_additional_mrf_urls.join('|'),
    evidence_pointer_sha256s: evidence.pointer_sha256s.join('|'),
    evidence_pointer_location_names: evidence.pointer_location_names.join('|'), header_match_reason: evidence.header_match_reason,
    matched_mrf_candidates: evidence.matched_mrf_candidates,
    review_mrf_candidates: evidence.review_mrf_candidates, linked_mrf_candidates: evidence.linked_mrf_candidates }));
  fs.writeFileSync(path.join(outputDir, 'nationwide-verification.csv'), toRFC4180(flat, Object.keys(flat[0])));
  const summaryPath = outputDir === AUDIT ? path.join(PRIVATE, 'summary.json') : path.join(outputDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out-dir');
  if (outIndex >= 0 && !args[outIndex + 1]) throw new Error('--out-dir requires a path');
  main(outIndex >= 0 ? args[outIndex + 1] : AUDIT);
}
module.exports = { metadataState, effectiveDispositionCategory, browserMetadataState, completeFullFileObservation, selectedFileEvidence, headerEvidenceForSelection, qualifyBrowserIdentity, choose, pointerObservation, manualPageFileRecheck, buildTargetIndexes, indexedPointerObservation, pointerRetainedBytesStatus, pointerCorpusProvenance,
  applyBrowserPointerObservation, disposition };
