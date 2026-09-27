'use strict';

const LABELS = {
  'linked-mrf-header-unmatched': 'Linked file returned; hospital identity unresolved',
  'pointer-discovery-incomplete': 'Pointer discovery incomplete',
  'pointer-not-retrieved': 'Pointer not retrieved from checked locations',
  'official-website-not-identified-completed-search': 'Official website not identified in completed search',
  'candidate-website-identity-unverified': 'Candidate website; identity unverified',
  'pointer-access-denied-to-client': 'Pointer access denied to this client',
  'mrf-facility-identity-unresolved': 'MRF hospital identity unresolved',
  'pointer-facility-match-unresolved': 'Pointer found; hospital match unresolved',
  'mrf-request-unsuccessful': 'MRF request unsuccessful',
  'mrf-verification-pending': 'MRF verification pending',
  'pointer-linked-file-not-probed': 'Pointer linked; file not yet probed',
  'pointer-linked-file-review-pending': 'Pointer and file header reviewed; current file finding pending',
  'file-custom-workbook-review': 'Custom workbook reviewed; CMS MRF identity or format unresolved',
  'selected-file-only-in-earlier-pointer-version': 'Selected file linked by earlier pointer version',
  'official-website-search-pending': 'Official website search pending'
};

const finding = disposition => 'not-assessed-nationwide-' + disposition;
const VERIFIED_FINDINGS = {
  'verified-current-mrf': 'compliant-observed',
  'verified-stale-mrf': 'mrf-stale-over-365-days',
  'verified-template-review': 'old-template-version',
  'verified-facility-metadata-unresolved': 'compliant-date-unverified',
  'scope-exempt-federal': 'not-applicable-federal',
  'scope-exempt-indian-health-program': 'not-applicable-indian-health-program',
  'scope-exempt-closed': 'not-applicable-closed',
  'scope-exempt-state-hospital': 'not-applicable-state-hospital'
};

function effectiveVerifiedFinding(record) {
  const mapped = VERIFIED_FINDINGS[record?.disposition];
  if (record?.disposition === 'verified-template-review'
      && record.cms_template_version && !/^[12](?:\.|$)/.test(String(record.cms_template_version)))
    return 'mrf-template-version-noncanonical';
  return mapped;
}

function firstUrl(value) {
  return String(value || '').split('|').map(item => item.trim()).find(Boolean) || '';
}

function observedDate(record) {
  return record.observed_at || record.browser_mrf_observed_at || record.browser_pointer_observed_at
    || record.pointer_observed_at || record.website_observed_at || '';
}

function applyNationwideVerification(rows, records = []) {
  const by = new Map();
  for (const record of records) {
    if (by.has(record.ccn)) throw new Error(`Duplicate nationwide verification ${record.ccn}`);
    if (!VERIFIED_FINDINGS[record.disposition] && !LABELS[record.disposition])
      throw new Error(`Unknown nationwide disposition ${record.disposition}`);
    by.set(record.ccn, record);
  }
  return rows.map(row => {
    const record = by.get(row.ccn);
    const canOverlayUnassessedStanding = /^not-assessed-/.test(String(row.finding || ''))
      && row.finding !== 'not-assessed-identity-conflict';
    if (!record || record.latest_observation_superseded || record.standing_evidence_retained
        || (!canOverlayUnassessedStanding && record.prior_finding !== row.finding)
        || record.hospital_name !== row.hospital_name || record.city !== row.city || record.state !== row.state)
      return row;
    const mapped = VERIFIED_FINDINGS[record.disposition];
    const checkedAt = observedDate(record) || row.checked_at;
    // A later observation is not automatically stronger evidence. Keep the
    // dated standing finding while the separate assessment reports the retry.
    if (Number.isFinite(Date.parse(row.checked_at))
        && (!Number.isFinite(Date.parse(checkedAt)) || Date.parse(checkedAt) < Date.parse(row.checked_at))) return row;
    if (row.finding === 'not-assessed-identity-conflict') return row;
    if (row.finding === 'not-assessed-site-corrected' && !mapped) return row;
    if ((!mapped || record.disposition === 'verified-facility-metadata-unresolved')
        && ['compliant-observed', 'compliant-date-unverified', 'mrf-stale-over-365-days', 'old-template-version',
          'mrf-license-state-field-conflicts-facility', 'mrf-address-field-conflicts-facility',
          'mrf-template-version-noncanonical', 'mrf-custom-workbook-metadata-unverified',
          'pricing-page-links-older-mrf-than-pointer'].includes(row.finding)) return row;
    // A new file cannot replace a standing claim on a version string alone.
    // For the *same* file, a newer matched header repeating the standing
    // literal is enough to correct the label on that observed metadata.
    if (record.disposition === 'verified-template-review'
        && !/^[12](?:\.|$)/.test(String(record.cms_template_version || ''))) {
      const sameFileVersionProof = row.finding === 'compliant-observed'
        && !!record.cms_template_version && record.cms_template_version !== '3.0.0'
        && row.mrf_url === record.mrf_url && row.cms_template_version === record.cms_template_version
        && record.metadata_source === 'header-observation'
        && record.facility_identity === 'corroborated-by-pointer-and-header'
        && !!record.header_identity_gate && /^2\d\d$/.test(String(record.mrf_http_status || ''));
      if (sameFileVersionProof) return { ...row,
        finding: effectiveVerifiedFinding(record), checked_at: checkedAt,
        evidence: `Matched header rechecked the same file and repeated literal CMS template version ${record.cms_template_version}; current-template label requires review. Prior finding: ${row.finding}.`
      };
      const exactReplacementProof = row.finding === 'compliant-observed'
        && !!record.cms_template_version && record.cms_template_version !== '3.0.0'
        && row.mrf_url !== record.mrf_url && !!record.mrf_url
        && record.metadata_source === 'header-observation'
        && record.facility_identity === 'corroborated-by-pointer-and-header'
        && !!record.header_identity_gate && /^2\d\d$/.test(String(record.mrf_http_status || ''))
        && record.pointer_state === 'retrieved-facility-linked'
        && record.pointer_corpus_raw_integrity === 'hash-corroborated'
        && !!record.pointer_corpus_sha256
        && record.evidence?.pointer_sha256s?.includes(record.pointer_corpus_sha256)
        && String(record.pointer_url || '').split('|').includes(record.pointer_corpus_checked_url)
        && Number(record.evidence?.matched_mrf_candidates) === 1
        && Number.isFinite(Date.parse(record.pointer_corpus_observed_at))
        && Date.parse(record.pointer_corpus_observed_at) >= Date.parse(row.checked_at);
      if (!exactReplacementProof) return row;
    }
    const exactReplacementNote = record.disposition === 'verified-template-review'
      && row.finding === 'compliant-observed' && row.mrf_url !== record.mrf_url
      && record.pointer_state === 'retrieved-facility-linked'
      ? ` Exact-CCN pointer bytes (${record.pointer_corpus_sha256}) and matched file header support this replacement; the file declares literal CMS template version ${record.cms_template_version}. Earlier file retained in history.` : '';
    const evidence = `${mapped ? 'Nationwide verification' : LABELS[record.disposition]}. ${record.pointer_reason || ''}`.trim()
      + exactReplacementNote
      + (record.next_action ? ` Next: ${record.next_action}` : '');
    if (!mapped || record.disposition.startsWith('scope-exempt-')) return {
      ...row,
      finding: mapped || finding(record.disposition),
      assessable: 'no',
      evidence,
      checked_at: checkedAt,
      ...(record.disposition.startsWith('scope-exempt-') ? {
        pointer_url: '', mrf_url: '', mrf_last_updated: '', mrf_days_since_update: '', cms_template_version: ''
      } : {})
    };
    const date = record.declared_last_updated || '';
    const days = date && checkedAt && Number.isFinite(Date.parse(date)) && Number.isFinite(Date.parse(checkedAt))
      ? String(Math.floor((Date.parse(checkedAt) - Date.parse(date + 'T00:00:00Z')) / 86400000)) : '';
    return {
      ...row,
      finding: effectiveVerifiedFinding(record),
      assessable: 'yes',
      evidence,
      domain: record.official_domain || row.domain,
      pointer_url: firstUrl(record.pointer_url) || row.pointer_url,
      mrf_url: record.mrf_url || row.mrf_url,
      mrf_last_updated: date,
      mrf_days_since_update: days,
      cms_template_version: record.cms_template_version || '',
      checked_at: checkedAt
    };
  });
}

function toAssessment(record) {
  return {
    checked_at: observedDate(record),
    website: record.website_state || '',
    pointer: record.pointer_state || '',
    ...(record.pointer_corpus_raw_integrity === 'hash-conflict'
      ? { pointer_raw_integrity: 'hash-conflict' } : {}),
    ...(/^https?:\/\//i.test(record.pointer_historical_checked_url || '')
      ? { pointer_historical_checked_url: record.pointer_historical_checked_url,
        pointer_historical_observed_at: record.pointer_historical_observed_at || '',
        pointer_historical_raw_integrity: record.pointer_historical_raw_integrity || '' } : {}),
    ...(record.pointer_state === 'retrieved-facility-match-unresolved' && /^https?:\/\//i.test(record.pointer_corpus_checked_url || '')
      ? { pointer_checked_url: record.pointer_corpus_checked_url,
        pointer_final_url: /^https?:\/\//i.test(record.pointer_corpus_final_url || '') ? record.pointer_corpus_final_url : '',
        pointer_corpus_observed_at: record.pointer_corpus_observed_at || '',
        pointer_corpus_sha256: record.pointer_corpus_sha256 || '' } : {}),
    identity: record.facility_identity || '',
    file_access: record.browser_mrf_status || (record.mrf_http_status ? `HTTP ${record.mrf_http_status}` : record.mrf_state || ''),
    metadata: record.declared_last_updated || record.cms_template_version
      ? [record.declared_last_updated, record.cms_template_version && `CMS ${record.cms_template_version}`].filter(Boolean).join(' / ')
      : record.mrf_state || '',
    browser_observation: [record.browser_pointer_status, record.browser_mrf_status].filter(Boolean).join(' / '),
    blocker: record.next_action || '',
    disposition: record.disposition
  };
}

function synchronizeManifest(manifest, rows) {
  const by = new Map(manifest.map(row => [row.ccn, row]));
  return rows.filter(row => row.mrf_url && (by.has(row.ccn) || row.assessable === 'yes')).map(row => {
    const prior = by.get(row.ccn) || {};
    const sameFile = prior.mrf_url === row.mrf_url;
    // Measurements for an old URL cannot describe the replacement file.
    const result = sameFile ? { ...prior } : { ccn: row.ccn,
      mrf_bytes: '', mrf_format: '', mrf_file_kind: '', mrf_http_status: '',
      source_page_url: '', extra_mrf_urls: '', match_method: 'nationwide-reviewed-view' };
    return { ...result, ...row, mrf_cms_version: row.cms_template_version || '',
      mrf_last_updated_raw: row.mrf_last_updated || '',
      mrf_date_source: row.mrf_last_updated ? 'file-metadata' : '',
      mrf_stale_over_365: row.mrf_days_since_update === '' ? '' : Number(row.mrf_days_since_update) > 365 ? 'yes' : 'no',
      mrf_checked_at: row.checked_at || '' };
  });
}

module.exports = { LABELS, VERIFIED_FINDINGS, effectiveVerifiedFinding, applyNationwideVerification, finding, firstUrl, observedDate, toAssessment, synchronizeManifest };
