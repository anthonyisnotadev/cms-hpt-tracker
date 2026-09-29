'use strict';

// Lead queue only. A newer unmatched header can contradict a retained standing
// finding, but neither a name difference nor a state field alone is a verdict.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const source = 'data/hpt-audit/nationwide-verification.json';
const rosterSource = 'cms_data/Hospital_General_Information.csv';
const reviewedSource = 'data/hpt-audit/reviewed-resolutions.json';
const completeSource = 'data/hpt-audit/claraprice-complete-metadata-2026-09-16.json';
const output = 'data/hpt-audit/retained-identity-review-queue.json';
const sourceBytes = fs.readFileSync(path.join(root, source));
const rosterBytes = fs.readFileSync(path.join(root, rosterSource));
const reviewedBytes = fs.readFileSync(path.join(root, reviewedSource));
const completeBytes = fs.readFileSync(path.join(root, completeSource));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sameUrlTarget = (left, right) => {
  try { return new URL(left).href === new URL(right).href; }
  catch { return false; }
};
const roster = new Map(csvToObjects(rosterBytes.toString('utf8')).map(row => [row['Facility ID'], row]));
const reviewed = new Map(JSON.parse(reviewedBytes.toString('utf8')).map(row => [row.ccn, row]));
const complete = new Map(JSON.parse(completeBytes.toString('utf8')).records.map(row => [row.ccn, row]));
const records = JSON.parse(sourceBytes.toString('utf8')).records
  .filter(row => row.standing_evidence_retained && row.facility_identity === 'not-corroborated'
    && row.standing_mrf_url && /^2\d\d$/.test(String(row.mrf_http_status)))
  .map(row => {
    const facility = roster.get(row.ccn) || {};
    const differentFacilityMatch = row.evidence?.header_match_reason === 'linked-file-matched-different-facility';
    const licenseStateConflict = Boolean(row.declared_license_state && row.declared_license_state !== row.state);
    // For JSON with a large standard_charge_information array, a bounded
    // prefix may capture only hospital_name. Missing fields in that sample
    // must not be reported as absent from the complete file.
    const metadataNotObservedInSample = row.evidence?.header_match_reason === 'mrf-header-has-no-license-state'
      && !row.declared_last_updated && !row.cms_template_version
      && !row.declared_address && !row.declared_location_name;
    const earlier = reviewed.get(row.ccn)?.evidence;
    const sameTargetReviewedMetadata = metadataNotObservedInSample
      && earlier?.identity === 'corroborated' && sameUrlTarget(earlier.url, row.standing_mrf_url)
      && earlier.date && earlier.version && /^[a-f0-9]{64}$/.test(String(earlier.fileSha256 || ''));
    const full = complete.get(row.ccn);
    const completeCurrentMetadata = metadataNotObservedInSample && !sameTargetReviewedMetadata
      && sameUrlTarget(full?.url, row.standing_mrf_url) && full.http_status === 200 && full.bytes > 0
      && /^[a-f0-9]{64}$/.test(String(full.file_sha256 || ''))
      && full.last_updated_on && full.version && full.license_state
      && full.hospital_address?.length && full.location_name?.length;
    const completeFileIdentityReviewed = completeCurrentMetadata
      && full.identity_review?.pointer_url === row.standing_pointer_url
      && full.identity_review?.pointer_http_status === 200
      && full.identity_review?.identity_page_http_status === 200
      && /^[a-f0-9]{64}$/.test(String(full.identity_review?.pointer_sha256 || ''))
      && /^[a-f0-9]{64}$/.test(String(full.identity_review?.identity_page_sha256 || ''));
    const crossStateDifferentFacility = differentFacilityMatch && licenseStateConflict;
    return {
      ccn: row.ccn,
      priority: differentFacilityMatch ? '1-different-facility-match'
        : licenseStateConflict ? '2-license-state-conflict'
        : sameTargetReviewedMetadata ? '3-reviewed-same-target-metadata'
        : completeCurrentMetadata ? '3b-complete-file-metadata-observed'
        : metadataNotObservedInSample ? '4-metadata-not-observed-in-sample' : '5-unresolved-identity',
      roster_name: row.hospital_name,
      roster_address: facility.Address || '',
      roster_city: row.city,
      roster_state: row.state,
      roster_zip: facility['ZIP Code'] || '',
      declared_hospital_name: row.declared_hospital_name,
      declared_location_name: row.declared_location_name,
      declared_address: row.declared_address,
      declared_license_state: row.declared_license_state,
      header_match_reason: metadataNotObservedInSample
        ? 'mrf-header-metadata-not-observed-in-bounded-sample' : row.evidence?.header_match_reason || '',
      source_header_match_reason: row.evidence?.header_match_reason || '',
      observation_scope: metadataNotObservedInSample ? 'bounded-sample-hospital-name-only' : 'header-identity-review',
      earlier_reviewed_same_target: Boolean(sameTargetReviewedMetadata),
      earlier_reviewed_file_sha256: sameTargetReviewedMetadata ? earlier.fileSha256 : '',
      earlier_reviewed_checked_at: sameTargetReviewedMetadata ? earlier.checked_at || '' : '',
      complete_file_metadata_observed: Boolean(completeCurrentMetadata),
      complete_file_sha256: completeCurrentMetadata ? full.file_sha256 : '',
      complete_file_checked_at: completeCurrentMetadata ? full.observed_at : '',
      complete_file_last_updated_on: completeCurrentMetadata ? full.last_updated_on : '',
      complete_file_version: completeCurrentMetadata ? full.version : '',
      complete_file_license_state: completeCurrentMetadata ? full.license_state : '',
      complete_file_pointer_identity_reviewed: Boolean(completeFileIdentityReviewed),
      cross_state_different_facility: crossStateDifferentFacility,
      standing_finding: row.standing_finding,
      standing_mrf_url_sha256: sha256(row.standing_mrf_url),
      observed_mrf_url_sha256: sha256(row.mrf_url || ''),
      standing_and_observed_mrf_same_target: sameUrlTarget(row.standing_mrf_url, row.mrf_url),
      observed_at: row.observed_at,
      next_action: sameTargetReviewedMetadata
        ? 'The same exact file URL already has a dated, hash-bound reviewed identity and metadata record. Retain it; this later prefix did not reach the root metadata. Recheck only for a stated file-change or freshness reason, without repeating facility discovery.'
        : completeFileIdentityReviewed
        ? 'The complete file, current exact root pointer and first-party campus identity have been reviewed. Preserve the observed current date/version; assess CMS file structure before any compliant-observed promotion. Do not repeat facility discovery without a material change.'
        : completeCurrentMetadata
        ? 'A complete, SHA-256-bound read of this exact file URL observed root date, version, address and license state after the large charge array. Review exact-CCN facility identity and current pointer before changing the standing finding; do not repeat the prefix-only metadata search.'
        : metadataNotObservedInSample
        ? 'Only hospital_name was observed in the bounded sample. Check whether root metadata occurs after a large charge array using a safe complete stream or publisher-supported tail request; do not infer that date, address, version or license fields are absent from the full file.'
        : 'Compare the exact roster facility with the original pointer entry, current first-party facility/page, and bounded MRF header. Quarantine only with independently corroborated different-facility proof; do not infer a legal verdict.'
    };
  })
  .sort((a, b) => a.priority.localeCompare(b.priority)
    || Number(b.cross_state_different_facility) - Number(a.cross_state_different_facility)
    || a.ccn.localeCompare(b.ccn));
const counts = Object.fromEntries(['1-different-facility-match', '2-license-state-conflict',
  '3-reviewed-same-target-metadata', '3b-complete-file-metadata-observed', '4-metadata-not-observed-in-sample', '5-unresolved-identity']
  .map(priority => [priority, records.filter(row => row.priority === priority).length]));
counts.cross_state_different_facility = records.filter(row => row.cross_state_different_facility).length;
const result = {
  purpose: 'Review retained standing claims contradicted or not corroborated by newer byte-backed headers; this file makes no automatic dispositions.',
  sources: {
    [source]: sha256(sourceBytes),
    [rosterSource]: sha256(rosterBytes),
    [reviewedSource]: sha256(reviewedBytes),
    [completeSource]: sha256(completeBytes)
  },
  total: records.length,
  counts,
  records
};
fs.writeFileSync(path.join(root, output), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ total: result.total, counts }, null, 2));
