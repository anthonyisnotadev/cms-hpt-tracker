'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { toRFC4180, normalizeUrl } = require('./pointer-corpus');
const { loadReviewedView } = require('./lib/reviewed-resolutions');
const { strongAddressAgreement, distinctiveNameOverlap } = require('./lib/mrf-header-match');
const { normalizeName } = require('./lib/util');
const { isSupportedIdentityUncertainty, reviewedResolutionSupersedes, resolutionObservedAt, standingEvidenceRetained } = require('./lib/reconciliation-precedence');

const ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(ROOT, 'data', 'hpt-audit');
const PRIVATE = path.join(ROOT, 'cms_data', 'hpt', 'nationwide-verification');
const POINTER_DIR = path.join(ROOT, 'cms_data', 'hpt', 'pointer-corpus');
const split = value => [...new Set(String(value || '').split('|').map(item => item.trim()).filter(Boolean))];
const add = (map, key, row) => { if (!map.has(key)) map.set(key, []); map.get(key).push(row); };

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
  const reviewedOperatorAlias = reviewedAddress && /operator|operated|association|parent|rename|facility/i.test(String(addressReview.basis || ''));
  if ((nameAgrees || reviewedOperatorAlias) && reviewedAddress) return { ...review, identity: 'corroborated', identity_gate: reviewedOperatorAlias && !nameAgrees ? 'reviewed-file-address-operator-alias' : 'reviewed-file-address-equivalence', address_review: addressReview };
  const addressAgrees = !!hospital?.address && addresses.some(value => strongAddressAgreement(hospital.address, value)
    && (recordedState ? recordedState === state : new RegExp('\\b' + state + '\\b', 'i').test(normalizeName(value))));
  if (nameAgrees && addressAgrees) return { ...review, identity_gate: 'recorded-file-name-street-state-agree' };
  return { ...review, identity: 'unverified', identity_gate: !names.length ? 'file-name-not-recorded'
    : !nameAgrees ? 'file-name-reconciliation-required' : !addresses.length ? 'file-address-not-recorded' : 'file-address-reconciliation-required' };
}

function metadataState(row) {
  // A declared older template is independently actionable even when the
  // publisher also omits last_updated_on. Do not let the missing date erase
  // the stronger, directly observed version evidence.
  if (!row.mrf_last_updated) return row.mrf_cms_version && String(row.mrf_cms_version).trim() !== '3.0.0'
    ? 'verified-older-or-unresolved-template' : 'metadata-unresolved';
  const days = Number(row.mrf_days_since_update);
  if (row.mrf_stale_over_365 === 'yes' || (Number.isFinite(days) && days > 365)) return 'verified-stale-date';
  if (String(row.mrf_cms_version || '').trim() !== '3.0.0') return 'verified-older-or-unresolved-template';
  return 'verified-current-v3';
}

function effectiveDispositionCategory(row) {
  if (row.latest_observation_superseded) return 'superseded-by-reviewed-resolution';
  if (row.standing_evidence_retained) return 'standing-evidence-retained';
  if (row.supported_identity_uncertainty) return 'supported-identity-uncertainty';
  if (String(row.disposition || '').startsWith('verified-')) return 'active-verification-claim';
  if (String(row.disposition || '').startsWith('scope-exempt')) return 'scope-exempt';
  return 'genuinely-unresolved';
}

function browserMetadataState(review) {
  return metadataState({
    mrf_last_updated: review.declared_last_updated,
    mrf_days_since_update: review.declared_last_updated
      ? Math.floor((Date.now() - Date.parse(review.declared_last_updated)) / 86400000) : '',
    mrf_cms_version: review.cms_template_version
  });
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

function choose(rows, ccn, hospitalName = '') {
  const matched = rows.filter(row => split(row.header_matched_ccns).includes(ccn));
  const review = rows.filter(row => split(row.review_ccns).includes(ccn));
  const linked = rows.filter(row => split(row.existing_matched_ccns).includes(ccn));
  const rank = row => ({ 'verified-current-v3': 5, 'verified-stale-date': 4,
    'verified-older-or-unresolved-template': 3, 'metadata-unresolved': 2 }[metadataState(row)] || 0);
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

function disposition(row, pointer, selected, mrfReview = null, currentPointerLinksSelected = false) {
  if (row.finding === 'not-applicable-federal') return ['scope-exempt-federal', 'Federal facility; retain scope exclusion unless the project scope changes.'];
  if (row.finding === 'not-applicable-closed') return ['scope-exempt-closed', 'Hospital closure is supported by dated official evidence; recheck only if hospital operations resume.'];
  if (selected.best && pointer.corpus_raw_integrity === 'hash-corroborated'
      && pointer.corpus_sha256 && !currentPointerLinksSelected
      && !split(selected.best.pointer_sha256s).includes(pointer.corpus_sha256)) {
    return ['selected-file-only-in-earlier-pointer-version',
      'The identity-matched file is supported by an earlier pointer version, not the latest retained root bytes. Check the latest pointer-declared target and publisher page independently; retain the older file as dated evidence.'];
  }
  if (selected.best) {
    const state = metadataState(selected.best);
    if (state === 'verified-current-v3') return ['verified-current-mrf', 'No discovery follow-up; recheck on the next scheduled crawl.'];
    if (state === 'verified-stale-date') return ['verified-stale-mrf', 'Recheck the pointer-declared file after publisher update or outreach.'];
    if (state === 'verified-older-or-unresolved-template') return ['verified-template-review', 'Inspect the declared CMS template version and recheck after publisher update.'];
    return ['verified-facility-metadata-unresolved', 'Complete a bounded/full metadata read for the matched file.'];
  }
  if (selected.review.length) return ['mrf-facility-identity-unresolved', 'Compare file header identity and address against this CCN and competing facilities.'];
  if (selected.linked.length) {
    if (mrfReview?.identity === 'conflicting') {
      return ['mrf-facility-identity-unresolved', 'Resolve the reviewed facility-identity conflict before retaining or replacing this MRF assignment.'];
    }
    if (mrfReview?.status === 'retrieved' && mrfReview.identity === 'corroborated') {
      const state = browserMetadataState(mrfReview);
      if (state === 'verified-current-v3') return ['verified-current-mrf', 'No discovery follow-up; recheck on the next scheduled crawl.'];
      if (state === 'verified-stale-date') return ['verified-stale-mrf', 'Recheck the pointer-declared file after publisher update or outreach.'];
      if (state === 'verified-older-or-unresolved-template') return ['verified-template-review', 'Inspect the declared CMS template version and recheck after publisher update.'];
      return ['verified-facility-metadata-unresolved', 'Complete a bounded/full metadata read for the browser-retrieved file.'];
    }
    if (mrfReview?.status === 'retrieved') return ['mrf-verification-pending', 'Parse and reconcile the browser-retrieved file identity and declared metadata.'];
    const statuses = selected.linked.map(item => Number(item.mrf_range_status || item.mrf_http_status || 0));
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

function main() {
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
  const generated_at = new Date().toISOString();
  const records = view.compliance.map(row => {
    const siteCorrection = appliedResolutions.has(row.ccn) && resolutionByCcn.get(row.ccn)?.action === 'correct-site'
      ? resolutionByCcn.get(row.ccn) : null;
    const discovery = discoveryByCcn.get(row.ccn);
    const searchReview = nationwideSearchByCcn.get(row.ccn);
    const reviewedDomain = searchReview?.status === 'official' ? searchReview.domain
      : discovery?.website?.identity === 'corroborated' ? discovery.website.domain : '';
    const websiteReview = searchReview?.status === 'candidate' ? 'candidate'
      : searchReview?.status === 'completed-no-official' ? 'completed-no-official'
        : discovery?.website?.identity === 'unverified' || discovery?.website?.plausible ? 'candidate'
          : discovery?.disposition === 'search-completed-no-official' ? 'completed-no-official' : '';
    const effective = { ...row, domain: row.domain || reviewedDomain, website_review: websiteReview };
    // A corrected hospital domain cannot inherit a sibling hospital's old
    // pointer or MRF merely because its pointer once named this facility.
    const exclusion = exclusionByCcn.get(row.ccn);
    const sourceHeaders = headerByCcn.get(row.ccn) || [];
    const selected = choose(siteCorrection ? [] : exclusion
      ? sourceHeaders.filter(header => header.mrf_url !== exclusion.excluded_mrf_url) : sourceHeaders,
    row.ccn, row.hospital_name);
    const best = selected.best;
    // Retain the separately observed file header, but never treat a file
    // harvested from HTML metadata as pointer-declared evidence.
    const invalidatedHeader = (invalidatedHeadersByCcn.get(row.ccn) || [])[0] || null;
    const candidate = best || selected.review[0] || selected.linked[0] || invalidatedHeader;
    const pointer = siteCorrection ? {
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
    const headerEvidence = headerEvidenceForSelection(selected, candidate, row.ccn);
    const mrfReview = qualifyBrowserIdentity(browserMrfByUrl.get(normalizeUrl(candidate?.mrf_url || row.mrf_url || '')) || null, roster.get(row.ccn), addressReviews.get(row.ccn));
    const currentPointerLinksSelected = !!best && pointerFilePairs.has(
      `${pointer.corpus_sha256}\0${normalizeUrl(best.mrf_url)}`);
    const [label, genericNextAction] = disposition(effective, pointer, selected, mrfReview, currentPointerLinksSelected);
    const next_action = siteCorrection
      ? (siteCorrection.evidence.next_action || 'Verify the repaired hospital-domain root pointer and exact MRF target; separately review the current page-linked CSV template and date.')
      : exclusion ? exclusion.next_action : genericNextAction;
    const fileEvidence = selectedFileEvidence(selected, candidate, mrfReview);
    const record = { ccn: row.ccn, hospital_name: row.hospital_name, city: row.city, state: row.state, hospital_type: row.type,
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
      pointer_state: pointer.state, pointer_url: siteCorrection?.evidence.rootPointerUrl || candidate?.pointer_urls || row.pointer_url
        || (pointer.state === 'retrieved-facility-linked' ? pointer.corpus_checked_url : ''), pointer_observed_at: pointer.observed_at,
      pointer_result: pointer.result, pointer_reason: pointer.reason,
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
      mrf_state: best ? metadataState(best)
        : mrfReview?.status === 'retrieved' && mrfReview.identity === 'corroborated' ? browserMetadataState(mrfReview)
          : selected.review.length ? 'identity-review' : selected.linked.length ? 'linked-unmatched-or-unreachable'
            : invalidatedHeader ? 'file-header-retained-pointer-unretrieved' : 'not-assessed',
      // A retained HTML-derived header may use a malformed/old URL. A later
      // guarded standing review supplies the authoritative page-linked URL.
      mrf_url: invalidatedHeader === candidate && row.mrf_url
        ? row.mrf_url : candidate?.mrf_url || row.mrf_url || '',
      mrf_http_status: candidate?.mrf_range_status || candidate?.mrf_http_status || '',
      browser_mrf_status: mrfReview?.status || '', browser_mrf_observed_at: mrfReview?.observed_at || '',
      browser_mrf_final_url: mrfReview?.final_url || '',
      browser_identity_gate: mrfReview?.identity_gate || '',
      header_identity_gate: headerEvidence.identity_gate,
      address_reconciliation: mrfReview?.address_review || null,
      facility_identity: best ? 'corroborated-by-pointer-and-header'
        : mrfReview?.identity === 'corroborated' ? 'corroborated-by-reviewed-browser-read'
          : mrfReview?.identity === 'conflicting' ? 'conflicting-reviewed-identity'
            : selected.review.length ? 'review-required' : selected.linked.length ? 'not-corroborated' : 'not-assessed',
      ...fileEvidence,
      observed_at: label === 'selected-file-only-in-earlier-pointer-version'
        ? pointer.observed_at || fileEvidence.observed_at || ''
        : fileEvidence.observed_at || pointer.observed_at || '', disposition: label, next_action,
      evidence: { pointer_sha256s: invalidatedHeader === candidate ? [] : split(candidate?.pointer_sha256s || '').slice(0, 8),
        invalidated_html_sha256s: invalidatedHeader === candidate ? split(candidate?.pointer_sha256s || '').slice(0, 8) : [],
        pointer_location_names: split(candidate?.pointer_location_names || '').slice(0, 16),
        header_match_reason: headerEvidence.match_reason,
        matched_mrf_candidates: selected.matched.length, review_mrf_candidates: selected.review.length,
        linked_mrf_candidates: selected.linked.length }, report_generated_at: generated_at };
    const resolution = resolutionByCcn.get(row.ccn);
    const superseded = reviewedResolutionSupersedes(resolution, record.observed_at, appliedResolutions.has(row.ccn));
    const retained = !superseded && standingEvidenceRetained(record.prior_finding, record.disposition);
    const supportedIdentity = !superseded && isSupportedIdentityUncertainty(resolution)
      && record.prior_finding === 'not-assessed-identity-conflict';
    return { ...record, observation_role: superseded ? 'superseded-retry' : retained ? 'incomplete-retry-standing-retained' : 'current-observation',
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
  const effective_counts = records.reduce((out, row) => {
    const category = effectiveDispositionCategory(row);
    out[category] = (out[category] || 0) + 1;
    return out;
  }, {});
  const summary = { generated_at, hospitals: records.length, unique_ccns: new Set(records.map(row => row.ccn)).size,
    fresh_pointer_documents: state.summary.pointerDocuments, unique_pointer_declared_mrfs: headers.length,
    counts, effective_counts, verified_facility_mrfs: records.filter(row => row.facility_identity === 'corroborated-by-pointer-and-header').length,
    superseded_observations: records.filter(row => row.latest_observation_superseded).length,
    standing_evidence_retained_observations: records.filter(row => row.standing_evidence_retained).length,
    active_verification_claims: records.filter(row => !row.latest_observation_superseded && row.disposition.startsWith('verified-')).length,
    unresolved: records.filter(row => !row.latest_observation_superseded && !row.standing_evidence_retained
      && !row.supported_identity_uncertainty
      && !/^verified-|^scope-exempt/.test(row.disposition)).length };
  fs.writeFileSync(path.join(AUDIT, 'nationwide-verification.json'), JSON.stringify({ summary, records }, null, 2) + '\n');
  const flat = records.map(({ evidence, ...row }) => ({ ...row,
    standing_additional_mrf_urls: row.standing_additional_mrf_urls.join('|'),
    evidence_pointer_sha256s: evidence.pointer_sha256s.join('|'),
    evidence_pointer_location_names: evidence.pointer_location_names.join('|'), header_match_reason: evidence.header_match_reason,
    matched_mrf_candidates: evidence.matched_mrf_candidates,
    review_mrf_candidates: evidence.review_mrf_candidates, linked_mrf_candidates: evidence.linked_mrf_candidates }));
  fs.writeFileSync(path.join(AUDIT, 'nationwide-verification.csv'), toRFC4180(flat, Object.keys(flat[0])));
  fs.writeFileSync(path.join(PRIVATE, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) main();
module.exports = { metadataState, effectiveDispositionCategory, browserMetadataState, selectedFileEvidence, headerEvidenceForSelection, qualifyBrowserIdentity, choose, pointerObservation, buildTargetIndexes, indexedPointerObservation, pointerRetainedBytesStatus, pointerCorpusProvenance,
  applyBrowserPointerObservation, disposition };
