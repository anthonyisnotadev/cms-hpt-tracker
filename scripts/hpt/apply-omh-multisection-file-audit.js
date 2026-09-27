'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofFile = 'reconciliation-omh-multisection-file-audit-2026-09-27.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofFile), 'utf8'));
const cmsRows = new Map(proof.records.map(record => [record.ccn, record]));
const complianceRows = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .map(row => [row.ccn, row]));
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const browserPath = path.join(audit, 'nationwide-browser-reviews.json');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const ledger = read(ledgerPath);
const manual = read(manualPath);
const browser = read(browserPath);
const confirmed = proof.records.filter(record => record.finding === 'facility-specific-current-mrf-section-confirmed');
const pending = proof.records.filter(record => record.finding !== 'facility-specific-current-mrf-section-confirmed');
const evidenceRun = 'omh-multisection-current-pointer-file-cms-roster-crosswalk-2026-09-27';
const alreadyResolved = new Map(ledger.map(record => [record.ccn, record]));

if (proof.counts.exact_facility_sections_confirmed !== 11 || proof.counts.already_supported_reviewed_findings !== 5
  || proof.counts.newly_supported_reviewed_findings !== 6 || proof.counts.remain_unresolved !== 3
  || confirmed.length !== 11 || pending.map(record => record.ccn).sort().join(',') !== '334004,334060,334061')
  throw new Error('OMH multi-section audit counts or conservative residual cohort changed');

function facilityAddress(record) {
  if (record.ccn === '334013') return '998 Crooked Hill Road, West Brentwood, NY 11717-1087';
  if (record.ccn === '334045') return '100 Washington Street, Elmira, NY 14901-2898';
  return record.cms_address;
}

for (const record of confirmed) {
  const previous = alreadyResolved.get(record.ccn);
  if (previous && (previous.action !== 'replace' || previous.finding !== 'verified-current-mrf'
    || previous.evidence?.url !== proof.source.shared_file_url
    || String(previous.evidence?.fileSha256 || '').toLowerCase() !== proof.source.current_full_file_sha256))
    throw new Error(`Existing resolution for ${record.ccn} does not match the verified multi-section source`);
  if (previous?.evidence_run === evidenceRun) continue;
  const base = complianceRows.get(record.ccn);
  const section = record.file_section;
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'current-CMS-CCN-name-address-crosswalk-plus-official-OMH-pointer-location-and-matching-facility-specific-section-name-address-state-date-version-attestation-and-usable-rows',
    officialDomain: 'omh.ny.gov',
    pointerUrl: proof.source.pointer_url,
    pointerSha256: proof.source.pointer_sha256,
    pointerLocationName: record.pointer_entry_name,
    sourcePageUrl: 'https://omh.ny.gov/omhweb/adults/omh-hospital-pricing-transparency.pdf',
    url: proof.source.shared_file_url,
    finalUrl: proof.source.shared_file_url,
    http_status: 200,
    checked_at: proof.observed_at,
    date: '2026-05-28',
    version: section.version,
    declared_hospital_name: section.section_name,
    location_name: section.location_name,
    declared_address: section.address,
    facility_address: facilityAddress(record),
    declared_license_state: section.license_state,
    facility_state: record.cms_address.match(/,\s*([A-Z]{2})\s+\d{5}/)?.[1] || 'NY',
    file_kind: 'csv',
    fileSha256: proof.source.current_full_file_sha256,
    fullFileBytes: proof.source.current_full_file_bytes,
    columns: section.columns,
    dataRows: section.data_rows,
    malformedRowWidths: section.malformed_row_widths,
    attestationPresent: section.attestation,
    fileSectionCount: proof.source.facility_sections_in_download,
    cmsRosterDataset: proof.cms_source.dataset,
    cmsRosterDatasetUrl: proof.cms_source.dataset_url,
    cmsRosterQueryUrl: proof.cms_source.query_url,
    cmsRosterResponseSha256: proof.cms_source.response_sha256,
    observedFinding: 'date-within-365-days-version-3',
  };
  if (record.address_variation) evidence.addressVariation = record.address_variation;
  if (record.ccn === '334013') {
    evidence.identityPageUrl = 'https://omh.ny.gov/omhweb/facilities/pgpc/';
    evidence.identityPageSha256 = '04aef0bb374e7e6e6e2745b2871a7e9b5025c100e35ec087f5d47c31b581861b';
  }
  if (record.ccn === '334045') {
    evidence.identityPageUrl = 'https://omh.ny.gov/omhweb/facilities/elpc/';
    evidence.identityPageSha256 = 'b4fa7da6ff6e87ce5b4dcfb1da9d4118a5bc8a847a498cad7be511665d144c03';
  }
  const currentResolution = {
    ccn: record.ccn,
    base,
    action: 'replace',
    finding: 'verified-current-mrf',
    evidence,
    evidence_run: evidenceRun,
    reviewed_at: proof.observed_at,
    note: `The current official OMH root pointer has a named ${record.pointer_entry_name} entry linked to this shared download. A full, hash-bound 929,041-byte retrieval contains a separate ${section.version} facility section for ${section.section_name} at ${section.address}; its ${section.data_rows} section rows have ${section.columns} columns with no malformed widths, a declared update of 2026-05-28 and attestation. The current CMS Hospital General Information CCN/name/address/state row matches; ${record.address_variation || 'the facility name, address and state agree'}. This is observed current-file evidence, not a legal compliance conclusion. The matching NPI was not used as an identity requirement because this multi-facility bundle carries program-specific NPIs in its service rows.`,
  };
  if (previous) {
    currentResolution.prior_review = previous.prior_review || {
      evidence_run: previous.evidence_run,
      reviewed_at: previous.reviewed_at,
      note: previous.note,
      file_sha256: previous.evidence?.fileSha256 || '',
      file_url: previous.evidence?.url || '',
    };
    Object.assign(previous, currentResolution);
  } else ledger.push(currentResolution);
}

for (const record of proof.records) {
  const section = record.file_section;
  const disposition = record.finding === 'facility-specific-current-mrf-section-confirmed'
    ? 'official-shared-file-facility-section-confirmed'
      : record.ccn === '334004' ? 'file-address-conflict-cms-roster'
      : 'official-pointer-and-bundle-lack-facility-specific-section';
  const observation = {
    ccn: record.ccn,
    observed_at: proof.observed_at,
    proof_file: proofFile,
    pointer_url: record.pointer_mrf_url || proof.source.pointer_url,
    pointer_sha256: proof.source.pointer_sha256,
    mrf_url: proof.source.shared_file_url,
    mrf_http_status: proof.source.current_http_status,
    mrf_content_type: proof.source.current_content_type,
    mrf_bytes: proof.source.current_full_file_bytes,
    mrf_sha256: proof.source.current_full_file_sha256,
    file_section_name: section?.section_name || '',
    file_section_address: section?.address || '',
    file_section_date: section?.declared_date_raw || '',
    file_section_version: section?.version || '',
    file_section_rows: section?.data_rows || 0,
    cms_roster_response_sha256: proof.cms_source.response_sha256,
    disposition,
    interpretation: record.finding === 'facility-specific-current-mrf-section-confirmed'
      ? `The full current shared OMH download has 20 separately headed facility sections. The ${record.pointer_entry_name} pointer entry, section-level name/address/state/date/version/attestation, and current CMS CCN roster support this facility-specific observed file finding. Earlier first-section-only review does not characterize the whole download.`
      : record.ccn === '334004'
        ? 'The matching facility section exists and has usable current CMS 3.0.0 rows, but its 79-25 Winchester Boulevard address conflicts with the current CMS roster address 80-45 Winchester Blvd Bldg B. Keep the file unassigned pending publisher clarification.'
        : 'The current CMS roster confirms the facility identity, but the retained OMH pointer has no matching facility entry and the 20-section file has no facility-specific section for this CCN. Keep unresolved.',
    next_action: record.next_action,
  };
  const old = manual.records.find(item => item.ccn === record.ccn && item.proof_file === proofFile);
  if (old) Object.assign(old, observation);
  else manual.records.push(observation);
}

const priorElmiraBrowserReviews = browser.records.filter(record => record.target === proof.source.shared_file_url
  && record.kind === 'mrf' && (/elmira/i.test(String(record.detail || '')) || record.ccn === '334045'));
for (const record of priorElmiraBrowserReviews) {
  record.superseded_interpretation_by = proofFile;
  record.scope_limit = 'bounded-prefix-only; the first Greater Binghamton metadata section was not the entire multi-section file';
}
if (!browser.records.some(record => record.kind === 'mrf-multisection-audit'
  && record.target === proof.source.shared_file_url && record.file_sha256 === proof.source.current_full_file_sha256)) {
  browser.records.push({
    kind: 'mrf-multisection-audit',
    target: proof.source.shared_file_url,
    final_url: proof.source.shared_file_url,
    status: 'full-file-retrieved-and-facility-sections-indexed',
    title: 'OMH consolidated hospital charges CSV: 20 facility sections',
    detail: `Full response: HTTP 200, ${proof.source.current_full_file_bytes} bytes, SHA-256 ${proof.source.current_full_file_sha256}. Quote-aware parsing found ${proof.source.facility_sections_in_download} independent CMS 3.0.0 metadata/table sections. Current CCN crosswalk reviewed ${proof.records.length} previously unresolved OMH facilities: ${proof.counts.exact_facility_sections_confirmed} facility sections confirmed and ${proof.counts.remain_unresolved} retained unresolved. The old first-section-only Greater Binghamton interpretation is superseded as a whole-file inference; its bounded observation remains historical. See ${proofFile}.`,
    browser: 'full-http-response-plus-quote-aware-csv-section-audit',
    http_status: 200,
    bytes_read: proof.source.current_full_file_bytes,
    content_type: proof.source.current_content_type,
    identity: 'multi-facility-sectioned',
    file_sha256: proof.source.current_full_file_sha256,
    observed_at: proof.observed_at,
    ccns_reviewed: proof.records.map(record => record.ccn),
    pointer_url: proof.source.pointer_url,
    pointer_sha256: proof.source.pointer_sha256,
  });
}

write(ledgerPath, ledger);
write(manualPath, manual);
write(browserPath, browser);
process.stdout.write(`New MRF resolutions: ${proof.counts.newly_supported_reviewed_findings}; refreshed prior positive findings: ${proof.counts.already_supported_reviewed_findings}; unresolved retained: ${proof.counts.remain_unresolved}.\n`);
