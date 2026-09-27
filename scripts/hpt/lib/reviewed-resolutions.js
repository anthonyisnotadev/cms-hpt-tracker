'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./util');
const { metadataStatus } = require('../recheck-interventions');
const { extractDeclared, toISODate } = require('./probe');
const { applyReviewedVerificationOverlays } = require('./reviewed-verification-overlays');

// Apply a reviewed, dated ledger to the current presentation. Original audit
// CSVs remain immutable, and base checks prevent an old correction overriding
// a subsequent crawl. All builders consume this same effective view.
function applyResolutions(compliance, manifest, gaps, resolutions = []) {
  const by = new Map(), history = {};
  for (const r of resolutions) {
    if (by.has(r.ccn)) throw new Error(`Duplicate resolution ${r.ccn}`);
    if (!['replace', 'replace-observation', 'correct-site', 'quarantine', 'exempt-closed', 'exempt-state-hospital'].includes(r.action)) throw new Error(`Unknown resolution action ${r.action}`);
    by.set(r.ccn, r);
  }
  const applied = new Map();
  const rows = compliance.map(row => {
    const resolution = by.get(row.ccn);
    if (!resolution) return row;
    if (['finding', 'domain', 'pointer_url', 'mrf_url', 'checked_at'].some(k => (row[k] || '') !== (resolution.base[k] || ''))) return row;
    const e = resolution.evidence;
    if (resolution.action === 'correct-site' && (!resolution.official?.domain || !e?.identityPageUrl
        || !/^[a-f0-9]{64}$/.test(String(e?.identityPageSha256 || ''))
        || !e?.facilityName || !e?.facilityAddress || !Number.isFinite(Date.parse(e?.checked_at))
        || !Number.isFinite(Date.parse(resolution.reviewed_at))
        || !Number.isInteger(e.rootPointerHttpStatus)
        || !((e.rootPointerHttpStatus >= 400 && e.rootPointerHttpStatus < 600)
          || (e.rootPointerHttpStatus === 200 && e.rootPointerResponseKind === 'structured-facility-pointer'
            && /^[a-f0-9]{64}$/.test(String(e.rootPointerSha256 || ''))
            && e.rootPointerLocationName && e.rootPointerFileTargetSha256
            && /^[a-f0-9]{64}$/.test(String(e.rootPointerFileTargetSha256))
            && e.rootPointerFileHeaderName && e.rootPointerFileHeaderAddress
            && e.rootPointerFileHeaderState && e.rootPointerFileHeaderState === e.facilityState)
          || (e.rootPointerHttpStatus === 202 && e.rootPointerResponseKind === 'html-security-challenge'
            && /^[a-f0-9]{64}$/.test(String(e.rootPointerSha256 || ''))
            && e.rootPointerChallengeMarker === '/.well-known/sgcaptcha/'))
        || !(new URL(e.identityPageUrl).hostname.replace(/^www\./, '') === resolution.official.domain
          || (e.identityAuthority === 'state-hospital-directory-current'
            && new URL(e.identityPageUrl).hostname === 'healthcarereportcard.illinois.gov'
            && e.directoryListedDomain === resolution.official.domain)
          || (e.identityAuthority === 'wyoming-state-directory-and-current-first-party-web'
            && new URL(e.identityPageUrl).hostname === 'health.wyo.gov'
            && e.directoryListedDomain === resolution.official.domain
            && e.directoryCcn === row.ccn
            && e.directoryAddress === e.facilityAddress
            && e.facilityState === row.state
            && new URL(e.firstPartyPageUrl).hostname.replace(/^www\./, '') === resolution.official.domain
            && e.firstPartyPageAddress === e.facilityAddress
            && Number.isFinite(Date.parse(e.firstPartyPageObservedAt))
            && e.firstPartyPointerUrl === e.rootPointerUrl
            && e.webPointerLocationName === e.facilityName
            && e.webPointerMrfUrl === e.fileSampleUrl
            && /^[a-f0-9]{64}$/.test(String(e.fileSampleSha256 || ''))
            && Number(e.fileSampleBytes) >= 65536
            && /^\d{4}-\d{2}-\d{2}$/.test(String(e.fileDeclaredDate || ''))
            && e.fileDeclaredVersion === '3.0.0'
            && String(e.fileDeclaredAddress || '').toUpperCase().replace(/\bSTREET\b/g, 'ST').replace(/\s+/g, ' ').trim()
              === String(e.facilityAddress || '').toUpperCase().replace(/\bSTREET\b/g, 'ST').replace(/\s+/g, ' ').trim()
            && e.fileDeclaredState === e.facilityState))
        || new URL(e.rootPointerUrl).hostname.replace(/^www\./, '') !== resolution.official.domain
        || row.domain === resolution.official.domain))
      throw new Error(`Site correction ${row.ccn} lacks current first-party identity and root-pointer evidence`);
    if (resolution.action === 'exempt-closed' && (!e?.closureDate || !e?.checked_at
        || !Array.isArray(e?.officialSources) || !e.officialSources.length))
      throw new Error(`Resolution ${row.ccn} lacks dated official closure evidence`);
    if (resolution.action === 'exempt-state-hospital' && (resolution.official?.domain !== 'hhs.texas.gov'
        || !e?.facilityName || !e?.checked_at
        || !e?.facilityUrl || !e?.stateOperatorAuthority || !e?.stateOperatorSource
        || !e?.federalRuleSource || !e?.federalRuleSection
        || !Array.isArray(e?.stateHospitalStatuteFacilities) || !e.stateHospitalStatuteFacilities.includes(e.facilityName)
        || !resolution.official?.domain))
      throw new Error(`Resolution ${row.ccn} lacks exact state-hospital and federal-scope evidence`);
    if (resolution.action === 'exempt-state-hospital'
        && resolution.official?.page !== e.facilityUrl)
      throw new Error(`Resolution ${row.ccn} official page must equal the exact facility page in its scope proof`);
    if (resolution.action === 'replace' || resolution.action === 'replace-observation') {
      const metadata = e && metadataStatus({ declared_date: e.date, version: e.version }, Date.parse(e.checked_at));
      const pageLinkedThirdParty = e?.observedFinding === 'official-page-third-party-mrf'
        && e.pointerIssue === 'page-linked-third-party-host'
        && e.sourcePageUrl === e.pointerUrl
        && (e.browserPageObservedAt || e.pageObservedAt)
        && (e.browserPageStatus === 200 || e.pageStatus === 200);
      const observationValid = resolution.action !== 'replace-observation'
        || (e.observedFinding === 'mrf-stale-over-365-days' && metadata === 'date-over-365-days')
        || (e.observedFinding === 'old-template-version' && metadata === 'date-within-365-days-older-version')
        || (e.observedFinding === 'mrf-custom-workbook-metadata-unverified'
          && metadata === 'date-unverified' && !e.version
          && e.schema_status === 'cms-template-not-declared-custom-workbook' && e.file_kind === 'xlsx'
          && e.generation_date && /^[a-f0-9]{64}$/.test(String(e.fileSha256 || ''))
          && Number(e.bytesRetained) > 0)
        || (e.observedFinding === 'pointer-lists-no-mrf-url' && e.pointerIssue === 'misspelled-mfr-url'
          && metadata === 'date-within-365-days-version-3')
        || (e.observedFinding === 'pointer-lists-no-mrf-url' && e.pointerIssue === 'omitted-mrf-url-label'
          && metadata === 'date-within-365-days-version-3')
        || (e.observedFinding === 'pointer-links-older-mrf-than-source-page'
          && e.pointerIssue === 'pointer-and-current-source-page-mrf-differ'
          && e.pointerMrfUrl && e.pointerMrfUrl !== e.url
          && ['date-within-365-days-version-3', 'date-over-365-days'].includes(metadata))
        || (e.observedFinding === 'pointer-links-different-facility-mrf-source-page-file'
          && e.pointerIssue === 'pointer-file-identifies-different-facility'
          && e.pointerMrfUrl && e.pointerMrfUrl !== e.url
          && /^2\d\d$/.test(String(e.pointerMrfHttpStatus))
          && /^[a-f0-9]{64}$/.test(String(e.pointerMrfSha256 || ''))
          && e.pointerMrfDeclaredAddress && e.facility_address
          && e.pointerMrfDeclaredAddress !== e.facility_address
          && e.declared_address === e.facility_address
          && e.identityPageUrl && /^[a-f0-9]{64}$/.test(String(e.identityPageSha256 || ''))
          && e.sourcePageUrl && /^[a-f0-9]{64}$/.test(String(e.sourcePageSha256 || ''))
          && ['date-within-365-days-version-3', 'date-over-365-days'].includes(metadata))
        || (e.observedFinding === 'pointer-links-unavailable-mrf-source-page-current-file'
          && e.pointerIssue === 'pointer-mrf-http-error-current-source-page-file'
          && e.pointerMrfUrl && e.pointerMrfUrl !== e.url
          && Number(e.pointerMrfHttpStatus) >= 400
          && metadata === 'date-within-365-days-version-3')
        || (e.observedFinding === 'pointer-target-dns-unresolved-page-file-found'
          && e.pointerIssue === 'pointer-file-dns-client-failure'
          && e.pointerMrfUrl && e.pointerMrfUrl !== e.url
          && Number(e.pointerMrfHttpStatus) === 0
          && /(?:resolving timed out|could not resolve host|no such host|name resolution)/i.test(String(e.pointerMrfTransportError || ''))
          && e.browserTargetErrorCode === 'ERR_NAME_NOT_RESOLVED'
          && /^\d{4}-\d{2}-\d{2}$/.test(String(e.browserObservedOn || ''))
          && e.sourcePageUrl && e.sourcePageSha256
          && metadata === 'date-within-365-days-version-3')
        || (e.observedFinding === 'pointer-http-client-error-page-file-found'
          && e.pointerIssue === 'pointer-http-url-client-empty-reply'
          && e.pointerMrfUrl && e.url
          && /^http:\/\//.test(e.pointerMrfUrl) && /^https:\/\//.test(e.url)
          && e.pointerMrfUrl === e.url.replace(/^https:/, 'http:')
          && Number(e.pointerMrfHttpStatus) === 0
          && /curl: \(52\) Empty reply from server/i.test(String(e.pointerMrfTransportError || ''))
          && e.browserTargetErrorCode === 'ERR_BLOCKED_BY_CLIENT'
          && e.sourcePageUrl && /^[a-f0-9]{64}$/.test(String(e.sourcePageSha256 || ''))
          && e.identityPageUrl && /^[a-f0-9]{64}$/.test(String(e.identityPageSha256 || ''))
          && metadata === 'date-within-365-days-version-3')
        || (e.observedFinding === 'pointer-links-html-download-page-with-file'
          && e.pointerIssue === 'mrf-url-resolves-html-page-linking-file'
          && e.pointerMrfUrl && e.pointerMrfUrl !== e.url
          && /^2\d\d$/.test(String(e.pointerMrfHttpStatus))
          && ['date-within-365-days-version-3', 'date-within-365-days-older-version', 'date-over-365-days'].includes(metadata))
        || (e.observedFinding === 'not-assessed-nationwide-linked-mrf-header-unmatched'
          && e.pointerIssue === 'mrf-url-resolves-html-page-linking-file'
          && e.pointerMrfUrl && e.pointerMrfUrl !== e.url
          && /^2\d\d$/.test(String(e.pointerMrfHttpStatus))
          && ['date-within-365-days-version-3', 'date-within-365-days-older-version', 'date-over-365-days'].includes(metadata))
        || (e.observedFinding === 'pointer-html-portal-not-found-source-page-current-file'
          && e.pointerIssue === 'pointer-html-portal-renders-not-found'
          && e.pointerMrfUrl && e.pointerMrfUrl !== e.url
          && /^2\d\d$/.test(String(e.pointerMrfHttpStatus))
          && e.browserPortalFinalUrl && /\/not-found$/.test(e.browserPortalFinalUrl)
          && e.browserPortalObservedAt && e.sourcePageUrl && e.sourcePageSha256
          && metadata === 'date-within-365-days-version-3')
        || (e.observedFinding === 'pointer-file-url-renders-not-found-source-page-current-file'
          && e.pointerIssue === 'pointer-file-like-url-renders-not-found'
          && e.pointerMrfUrl && e.pointerMrfUrl !== e.url
          && /^2\d\d$/.test(String(e.pointerMrfHttpStatus))
          && (e.browserPointerTargetFinalUrl === e.pointerMrfUrl
            || (e.browserPointerTargetRedirectedFrom === e.pointerMrfUrl
              && e.browserPointerTargetFinalUrl
              && e.browserPointerTargetFinalUrl !== e.pointerMrfUrl))
          && ['404 - Page Not Found', "We're sorry! Requested page not found."].includes(e.browserPointerTargetHeading)
          && e.browserPointerTargetObservedAt && e.sourcePageUrl && e.sourcePageSha256
          && metadata === 'date-within-365-days-version-3')
        || (e.observedFinding === 'official-page-mrf-root-pointer-unavailable'
          && ((e.pointerIssue === 'root-pointer-http-error'
            && (Number(e.pointerHttpStatus) >= 400
              || (Number(e.pointerHttpStatus) === 202
                && /^text\/html/i.test(String(e.pointerResponseContentType || ''))
                && Number(e.pointerResponseBytes) > 0
                && /^[a-f0-9]{64}$/.test(String(e.pointerSha256 || ''))))
            && (!e.pointerMrfUrl || e.pointerMrfUrl !== e.url))
            || (e.pointerIssue === 'root-pointer-html-not-found'
              && Number(e.pointerHttpStatus) === 200
              && /^text\/html/i.test(String(e.pointerResponseContentType || ''))
              && /\/404(?:\?|$)/.test(String(e.pointerFinalUrl || ''))
              && e.pointerResponseTitle === '404 - Page Not Found')
            || (e.pointerIssue === 'root-pointer-html-not-found'
              && Number(e.pointerHttpStatus) === 200
              && /^text\/html/i.test(String(e.pointerResponseContentType || ''))
              && e.pointerFinalUrl === e.pointerUrl
              && /page not found/i.test(String(e.pointerResponseTitle || ''))
              && e.browserPointerHeading === 'Oops, This Page Could Not Be Found!'))
          && ['date-within-365-days-version-3', 'date-within-365-days-older-version', 'date-over-365-days'].includes(metadata))
        || (e.observedFinding === 'root-pointer-omits-facility-page-file-found'
          && e.pointerIssue === 'root-pointer-omits-facility'
          && /^2\d\d$/.test(String(e.pointerHttpStatus))
          && e.pointerListsFacility === false
          && typeof e.facilityPointerToken === 'string' && e.facilityPointerToken.length >= 3
          && Array.isArray(e.pointerLocationNames) && e.pointerLocationNames.length > 0
          && e.pointerLocationNames.every(name =>
            !String(name).toLowerCase().includes(e.facilityPointerToken.toLowerCase()))
          && e.sourcePageUrl && /^[a-f0-9]{64}$/.test(String(e.sourcePageSha256 || ''))
          && e.identityPageUrl && /^[a-f0-9]{64}$/.test(String(e.identityPageSha256 || ''))
          && e.fileKind === 'csv' && Number(e.fileBytes) > 0
          && Number(e.fileBytes) === Number(e.fileTotalBytes)
          && metadata === 'date-within-365-days-version-3')
        || (e.observedFinding === 'root-pointer-omits-facility-official-storage-file-found'
          && e.pointerIssue === 'root-pointer-omits-facility-specific-entry'
          && /^2\d\d$/.test(String(e.pointerHttpStatus))
          && e.pointerListsFacility === false
          && Array.isArray(e.pointerLocationNames) && e.pointerLocationNames.length > 0
          && e.declared_hospital_name && e.location_name
          && String(e.declared_hospital_name).toUpperCase() === String(e.location_name).toUpperCase()
          && e.declared_address && e.declared_license_state && e.facility_state
          && String(e.declared_license_state).toUpperCase() === String(e.facility_state).toUpperCase()
          && e.file_kind === 'json'
          && /^[a-f0-9]{64}$/.test(String(e.fileSha256 || ''))
          && metadata === 'date-within-365-days-version-3')
        || (e.observedFinding === 'pointer-target-google-sheet-page-file-found'
          && e.pointerIssue === 'pointer-target-google-sheet-edit-page'
          && /^2\d\d$/.test(String(e.pointerHttpStatus))
          && e.pointerMrfUrl && e.pointerMrfUrl !== e.url
          && /docs\.google\.com\/spreadsheets\//i.test(String(e.pointerMrfUrl))
          && e.pointerTargetContentType && /^text\/html/i.test(String(e.pointerTargetContentType))
          && e.sourcePageUrl && /^[a-f0-9]{64}$/.test(String(e.sourcePageSha256 || ''))
          && e.identityPageUrl && /^[a-f0-9]{64}$/.test(String(e.identityPageSha256 || ''))
          && e.fileKind === 'csv' && Number(e.fileBytes) > 0
          && Number(e.fileBytes) === Number(e.fileTotalBytes)
          && metadata === 'date-within-365-days-version-3')
        || (e.observedFinding === 'root-pointer-html-page-with-official-page-file'
          && e.pointerIssue === 'root-path-serves-html-page'
          && /^2\d\d$/.test(String(e.pointerHttpStatus))
          && /^text\/html/i.test(String(e.pointerContentType || ''))
          && e.sourcePageUrl && e.sourcePageSha256
          && metadata === 'date-within-365-days-version-3')
        || (e.observedFinding === 'mrf-license-state-field-conflicts-facility'
          && e.declared_license_state && e.facility_state
          && e.declared_license_state !== e.facility_state
          && ['date-within-365-days-version-3', 'date-within-365-days-older-version',
            'date-within-365-days-version-unverified'].includes(metadata))
        || (e.observedFinding === 'mrf-address-field-conflicts-facility'
          && e.declared_address && e.facility_address
          && e.declared_address !== e.facility_address
          && ['date-within-365-days-version-3', 'date-within-365-days-older-version'].includes(metadata))
        || (e.observedFinding === 'mrf-address-field-incomplete'
          && e.declared_address && e.facility_address && e.missing_address_component
          && e.facility_address.includes(e.missing_address_component)
          && !e.declared_address.includes(e.missing_address_component)
          && /^[a-f0-9]{64}$/.test(String(e.fileSha256 || ''))
          && /^[a-f0-9]{64}$/.test(String(e.identityPageSha256 || ''))
          && metadata === 'date-within-365-days-version-3')
        || (e.observedFinding === 'mrf-template-version-noncanonical'
          && e.version && e.version !== '3.0.0' && e.expected_version === '3.0.0'
          && ['date-within-365-days-version-3', 'date-within-365-days-older-version',
            'date-within-365-days-version-unverified'].includes(metadata))
        || (e.observedFinding === 'pricing-page-links-older-mrf-than-pointer'
          && e.pageMrfUrl && e.pageMrfUrl !== e.url
          && /^[a-f0-9]{64}$/.test(String(e.pageMrfSha256 || ''))
          && /^2\d\d$/.test(String(e.pageMrfHttpStatus))
          && e.pageMrfDate && Date.parse(e.pageMrfDate) < Date.parse(e.date)
          && e.pageMrfVersion && e.pageMrfVersion !== e.version
          && e.sourcePageUrl && /^[a-f0-9]{64}$/.test(String(e.sourcePageSha256 || ''))
          && metadata === 'date-within-365-days-version-3')
        || (e.observedFinding === 'official-page-third-party-mrf'
          && e.pointerIssue === 'page-linked-third-party-host'
          && e.sourcePageUrl === e.pointerUrl
          && e.pricingToolUrl
          && (e.browserPageObservedAt || e.pageObservedAt)
          && (e.browserPageStatus === 200 || e.pageStatus === 200)
          && e.pointerMrfUrl === e.url
          && /^2\d\d$/.test(String(e.http_status))
          && e.declared_hospital_name && e.location_name
          && e.declared_address && e.facility_address
          && e.declared_license_state === e.facility_state
          && metadata === 'date-within-365-days-version-3');
      if (!e || e.identity !== 'corroborated' || !e.pointerUrl || !e.url || (!e.pointerSha256 && !pageLinkedThirdParty)
          || !/^2\d\d$/.test(String(e.http_status)) || !e.checked_at
          || (e.pointerMrfWrapperSha256 && (!/^[a-f0-9]{64}$/.test(e.pointerMrfWrapperSha256)
            || e.decodedPointerMrfUrl !== e.url
            || e.pointerFileResponseSha256 !== e.fileSha256
            || Number(e.fullFileBytes) <= 0
            || !/^[a-f0-9]{64}$/.test(String(e.pointerMrfSampleSha256 || ''))
            || e.pointerMrfSampleSha256 !== e.decodedTargetSampleSha256))
          || (e.additionalFiles != null && (!Array.isArray(e.additionalFiles)
            || !e.additionalFiles.length || e.additionalFiles.some(file =>
              !file?.url || file.url === e.url || !file.location_name
              || !/^[a-f0-9]{64}$/.test(String(file.fileSha256 || ''))
              || Number(file.bytesRetained) < 65536
              || !/^2\d\d$/.test(String(file.http_status))
              || file.declared_license_state !== e.declared_license_state
              || file.date !== e.date || file.version !== e.version
              || !file.declared_address || !Number.isFinite(Date.parse(file.checked_at)))))
          || (resolution.action === 'replace' && metadata !== 'date-within-365-days-version-3')
          || !observationValid) {
        throw new Error(`Resolution ${row.ccn} lacks current, pointer-linked identity and metadata evidence`);
      }
    }
    history[row.ccn] = { ...row, resolution_note: resolution.note };
    applied.set(row.ccn, resolution);
    if (resolution.action === 'correct-site') return { ...row,
      finding: 'not-assessed-site-corrected', assessable: 'no', domain: resolution.official.domain,
      pointer_url: '', mrf_url: '', mrf_last_updated: '', mrf_days_since_update: '', cms_template_version: '',
      checked_at: e.checked_at, evidence: resolution.note };
    if (resolution.action === 'quarantine') return { ...row,
      finding: 'not-assessed-identity-conflict', assessable: 'no', domain: resolution.official?.domain || '',
      pointer_url: '', mrf_url: '', mrf_last_updated: '', mrf_days_since_update: '', cms_template_version: '',
      checked_at: resolution.reviewed_at, evidence: resolution.note };
    if (resolution.action === 'exempt-closed') return { ...row,
      finding: 'not-applicable-closed', assessable: 'no', domain: resolution.official?.domain || row.domain,
      pointer_url: '', mrf_url: '', mrf_last_updated: '', mrf_days_since_update: '', cms_template_version: '',
      checked_at: e.checked_at, evidence: resolution.note };
    if (resolution.action === 'exempt-state-hospital') return { ...row,
      finding: 'not-applicable-state-hospital', assessable: 'no', domain: resolution.official.domain,
      pointer_url: '', mrf_url: '', mrf_last_updated: '', mrf_days_since_update: '', cms_template_version: '',
      checked_at: e.checked_at, evidence: resolution.note };
    return { ...row, finding: resolution.action === 'replace-observation' ? e.observedFinding : 'compliant-observed', assessable: 'yes',
      domain: e.officialDomain || new URL(e.pointerUrl).hostname, pointer_url: e.pointerUrl, mrf_url: e.url,
      mrf_last_updated: e.date || '', mrf_days_since_update: e.date
        ? String(Math.floor((Date.parse(e.checked_at) - Date.parse(e.date + 'T00:00:00Z')) / 86400000)) : '',
      cms_template_version: e.version, checked_at: e.checked_at,
      evidence: `Reviewed pointer/file identity and location; declared update ${e.date || 'unverified'}, version ${e.version || 'not declared'}. ${resolution.note}` };
  });
  const rowBy = new Map(rows.map(r => [r.ccn, r]));
  const manBy = new Map(manifest.map(r => [r.ccn, r]));
  for (const [ccn, resolution] of applied) {
    if (resolution.action === 'quarantine' || resolution.action === 'exempt-closed'
        || resolution.action === 'exempt-state-hospital' || resolution.action === 'correct-site') { manBy.delete(ccn); continue; }
    const row = rowBy.get(ccn), e = resolution.evidence;
    const indirect = (e.pointerMrfUrl && e.pointerMrfUrl !== e.url)
      || (e.pointerMrfWrapperSha256 && e.decodedPointerMrfUrl === e.url);
    manBy.set(ccn, { ...(manBy.get(ccn) || {}), ...row,
      location_name: e.location_name, pointer_via: indirect ? 'reviewed-indirect' : 'reviewed-direct',
      source_page_url: e.sourcePageUrl || '',
      extra_mrf_urls: (e.additionalFiles || []).map(file => file.url).join(' | '),
      mrf_format: e.file_kind, mrf_last_updated_raw: e.date || '', mrf_date_source: e.date ? 'file-metadata' : '',
      mrf_stale_over_365: row.mrf_days_since_update === '' ? '' : Number(row.mrf_days_since_update) > 365 ? 'yes' : 'no', mrf_cms_version: e.version || '',
      mrf_bytes: '', match_method: indirect ? 'reviewed-header-and-indirect-pointer-chain' : 'reviewed-header-and-pointer',
      match_corroboration: e.identity_basis, mrf_file_kind: e.file_kind, mrf_http_status: e.http_status,
      mrf_checked_at: e.checked_at, mrf_http_last_modified_diagnostic: '' });
  }
  const remaining = gaps.filter(r => !applied.has(r.ccn));
  for (const [ccn, resolution] of applied) if (resolution.action === 'correct-site') {
    const row = rowBy.get(ccn);
    const prior = gaps.find(item => item.ccn === ccn) || {};
    remaining.push({ ...prior, ...row,
      seeded_domain: resolution.official.domain,
      pointer_status: resolution.evidence.rootPointerResponseKind === 'structured-facility-pointer'
        ? 'reviewed-pointer-file-follow-up' : 'corrected-site-access-follow-up',
      remediation: 'corrected-site-follow-up',
      reason: resolution.evidence.next_action || resolution.note });
  }
  for (const [ccn, resolution] of applied) if (resolution.action === 'quarantine') {
    const row = rowBy.get(ccn);
    remaining.push({ ...row, remediation: 'name-match-review', reason: resolution.note, seeded_domain: row.domain, pointer_status: 'identity-review' });
  }
  return { compliance: rows, manifest: [...manBy.values()], gaps: remaining, history, applied: [...applied.keys()] };
}

const DOMAIN_OBSERVATION_FINDINGS = {
  'site-observed': 'not-assessed-site-observed',
  'pointer-review': 'not-assessed-pointer-review',
  'candidate-found': 'not-assessed-domain-candidate',
  'search-not-run': 'not-assessed-domain-search-pending',
  'search-error': 'not-assessed-domain-search-error',
  'no-candidate': 'not-assessed-no-domain-candidate'
};

// Refine only the presentation of still-domainless rows. These observations
// never assign a domain, pointer, MRF, assessability, or compliance verdict.
function applyDomainObservations(compliance, observations = []) {
  const by = new Map();
  for (const observation of observations) {
    if (by.has(observation.ccn)) throw new Error(`Duplicate domain observation ${observation.ccn}`);
    if (!DOMAIN_OBSERVATION_FINDINGS[observation.observation])
      throw new Error(`Unknown domain observation ${observation.observation}`);
    by.set(observation.ccn, observation);
  }
  return compliance.map(row => {
    const observation = by.get(row.ccn);
    if (!observation || row.finding !== 'not-assessed-domain-unknown') return row;
    // A report from an earlier crawl must not overwrite a later observation.
    if (row.domain || row.pointer_url || row.mrf_url) return row;
    if (row.checked_at && (!observation.checked_at
        || Date.parse(row.checked_at) > Date.parse(observation.checked_at))) return row;
    if (observation.base_sha256) {
      const digest = require('crypto').createHash('sha256').update(JSON.stringify(row)).digest('hex');
      if (digest !== observation.base_sha256) return row;
    }
    return { ...row,
      finding: DOMAIN_OBSERVATION_FINDINGS[observation.observation], assessable: 'no',
      evidence: observation.evidence,
      checked_at: observation.checked_at || row.checked_at
    };
  });
}

// The original import labeled every non-3.x string "older", including 4.x,
// 5.x and malformed version fields. Correct only that derived finding; retain
// the original audit row and the literal extracted value for review.
function correctTemplateVersionFinding(rows) {
  return rows.map(row => row.finding === 'old-template-version'
    && row.cms_template_version && row.cms_template_version !== 'unresolved-custom-workbook'
    && !/^[12](?:\.|$)/.test(row.cms_template_version)
    ? { ...row, finding: 'mrf-template-version-noncanonical',
      evidence: `Literal file version ${row.cms_template_version} is not an older 1.x/2.x template; version needs review. Original audit: ${row.evidence}` }
    : row);
}

function retainedParserCorrections(dir) {
  const file = path.join(dir, 'reconciliation-version-parser-corrections.json');
  if (!fs.existsSync(file)) return [];
  const proof = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byteProof = JSON.parse(fs.readFileSync(path.join(dir, 'nationwide-file-byte-proof.json'), 'utf8'));
  return proof.records.map(record => {
    const sample = path.resolve(dir, '../../cms_data/hpt/nationwide-verification/file-byte-proof',
      `${record.retained_sample_sha256}.bin`);
    const bytes = fs.readFileSync(sample);
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const source = byteProof.records.find(row => row.url === record.mrf_url && row.ccns?.includes(record.ccn));
    const parsed = extractDeclared(bytes, 'csv');
    if (hash !== record.retained_sample_sha256 || bytes.length !== record.retained_sample_bytes
      || source?.sha256 !== hash || source.parsed_root_candidates?.[0]?.cmsVersion !== record.previous_parser_value
      || parsed.version !== record.corrected_literal_value || toISODate(parsed.raw) !== record.declared_date
      || parsed.hospitalName !== record.declared_hospital_name)
      throw new Error(`Retained parser correction proof changed for ${record.ccn}`);
    return record;
  });
}

function applyRetainedParserCorrections(rows, corrections) {
  const byCcn = new Map(corrections.map(row => [row.ccn, row]));
  return rows.map(row => {
    const correction = byCcn.get(row.ccn);
    if (!correction) return row;
    if (row.mrf_url !== correction.mrf_url || row.cms_template_version !== correction.previous_parser_value)
      throw new Error(`Parser correction no longer matches standing row ${row.ccn}`);
    return { ...row, cms_template_version: correction.corrected_literal_value,
      finding: row.finding === 'old-template-version' ? 'mrf-template-version-noncanonical' : row.finding,
      evidence: `Retained CSV declares literal ${correction.corrected_literal_value}; earlier parser recorded ${correction.previous_parser_value}. Original audit: ${row.evidence}` };
  });
}

function loadReviewedView(dir, options = {}) {
  const read = file => csvToObjects(fs.readFileSync(path.join(dir, file), 'utf8'));
  const ledger = path.join(dir, 'reviewed-resolutions.json');
  const observations = path.join(dir, 'domain-observations.csv');
  const discovery = path.join(dir, 'discovery-review.json');
  const view = applyResolutions(read('compliance.csv'), read('manifest.csv'), read('gaps.csv'),
    fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf8')) : []);
  const discoveryRecords = fs.existsSync(discovery) ? JSON.parse(fs.readFileSync(discovery, 'utf8')).records : [];
  const discoveryCcns = new Set(discoveryRecords.map(r => r.ccn));
  const parserCorrections = retainedParserCorrections(dir);
  view.parserCorrections = parserCorrections;
  view.compliance = require('./discovery-review').applyDiscoveryReviews(view.compliance, discoveryRecords);
  view.compliance = applyDomainObservations(view.compliance,
    // If a new crawl invalidates this review, retain the crawl; do not fall
    // through to an even older single-batch observation for the same CCN.
    fs.existsSync(observations) ? read('domain-observations.csv').filter(r => !discoveryCcns.has(r.ccn)) : []);
  const nationwide = path.join(dir, 'nationwide-verification.json');
  if (options.nationwide !== false && fs.existsSync(nationwide)) {
    const report = JSON.parse(fs.readFileSync(nationwide, 'utf8'));
    for (const correction of parserCorrections) {
      const row = report.records.find(item => item.ccn === correction.ccn);
      if (!row || row.mrf_url !== correction.mrf_url || row.cms_template_version !== correction.previous_parser_value)
        throw new Error(`Parser correction no longer matches nationwide row ${correction.ccn}`);
      row.cms_template_version = correction.corrected_literal_value;
      row.parser_correction = correction;
    }
    report.records = applyReviewedVerificationOverlays(report.records || [], dir);
    const standingBeforeNationwide = new Map(view.compliance.map(row => [row.ccn, row]));
    view.compliance = require('./nationwide-verification-view').applyNationwideVerification(view.compliance, report.records || []);
    const nationwideByCcn = new Map((report.records || []).map(row => [row.ccn, row]));
    for (const row of view.compliance) {
      const prior = standingBeforeNationwide.get(row.ccn);
      const observation = nationwideByCcn.get(row.ccn);
      if (!prior || !observation || view.history[row.ccn]
          || !prior.mrf_url || prior.mrf_url === row.mrf_url
          || !row.mrf_url || row.assessable !== 'yes'
          || observation.mrf_url !== row.mrf_url
          || (observation.facility_identity !== 'corroborated-by-pointer-and-header'
            && !observation.reviewed_page_file_overlay)) continue;
      view.history[row.ccn] = { ...prior, history_source: 'nationwide-overlay',
        resolution_note: observation.reviewed_page_file_overlay
          ? `A later reviewed first-party page-file proof replaced the older MRF route; ${observation.reviewed_page_file_overlay} is retained as the dated evidence. The prior finding and URL remain in history.`
          : 'A later exact-CCN pointer and matched file header replaced this standing URL. The older file, date and finding are retained as dated history, not a current verification.' };
    }
    view.manifest = require('./nationwide-verification-view').synchronizeManifest(view.manifest, view.compliance);
    const located = new Set(view.compliance.filter(row =>
      ['compliant-observed', 'compliant-date-unverified', 'mrf-stale-over-365-days', 'old-template-version'].includes(row.finding)).map(row => row.ccn));
    view.gaps = view.gaps.filter(row => !located.has(row.ccn));
    view.nationwide = report;
  }
  view.compliance = applyRetainedParserCorrections(view.compliance, parserCorrections);
  view.compliance = correctTemplateVersionFinding(view.compliance);
  view.manifest = require('./nationwide-verification-view').synchronizeManifest(view.manifest, view.compliance);
  return view;
}
module.exports = { DOMAIN_OBSERVATION_FINDINGS, applyDomainObservations, applyResolutions,
  correctTemplateVersionFinding, applyRetainedParserCorrections, loadReviewedView };
