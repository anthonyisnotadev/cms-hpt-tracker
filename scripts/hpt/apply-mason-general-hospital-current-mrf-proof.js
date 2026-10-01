'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-mason-general-hospital-current-full-mrf-proof-2026-09-29.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const samplePath = path.join(root, proof.mrf.retained_sample.path);
const sample = fs.readFileSync(samplePath);
if (sample.length !== proof.mrf.retained_sample.bytes
    || sha256(sample) !== proof.mrf.retained_sample.sha256) {
  throw new Error('Retained Mason General bounded MRF sample does not match its source proof');
}
if (proof.ccn !== '501336' || proof.mrf.complete_file_bytes_streamed !== proof.mrf.content_length
    || !/^[a-f0-9]{64}$/.test(proof.mrf.complete_file_sha256)
    || proof.mrf.csv_structure_and_usability.data_row_widths.join(',') !== '33'
    || proof.mrf.csv_structure_and_usability.parsed_pricing_data_rows !== 623781
    || proof.official_root_pointer.parsed_mrf_url !== proof.mrf.url
    || proof.cms_provider_record.record.facility_id !== proof.ccn
    || !proof.mrf.declared_metadata.type_2_npi.includes('1760568752')) {
  throw new Error('Mason General proof no longer satisfies its exact-CCN/source invariants');
}

const compliance = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
const row = compliance.find(item => item.ccn === proof.ccn);
if (!row || row.finding !== 'not-assessed-nationwide-pointer-access-denied-to-client'
    || row.domain !== 'masonhealth.com'
    || row.pointer_url !== proof.official_root_pointer.url
    || row.mrf_url !== proof.official_source_page.url) {
  throw new Error('Mason General base row changed; review current evidence before applying');
}
const base = Object.fromEntries([
  'ccn', 'hospital_name', 'city', 'state', 'type', 'finding', 'assessable', 'evidence',
  'domain', 'pointer_url', 'mrf_url', 'mrf_last_updated', 'mrf_days_since_update',
  'cms_template_version', 'checked_at'
].map(key => [key, row[key] || '']));

const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (ledger.some(item => item.ccn === proof.ccn))
  throw new Error('Unexpected pre-existing Mason General reviewed resolution; reconcile explicitly');
ledger.push({
  ccn: proof.ccn,
  base,
  action: 'replace',
  finding: 'verified-current-mrf',
  evidence: {
    identity: 'corroborated',
    identity_basis: 'current-official-root-pointer-exact-mrf-full-stream-hash-cms-ccn-address-and-npi-registry-crosscheck',
    officialDomain: proof.official_domain,
    sourcePageUrl: proof.official_root_pointer.parsed_source_page_url,
    pointerUrl: proof.official_root_pointer.url,
    pointerSha256: proof.official_root_pointer.response_sha256,
    pointerLocationName: proof.official_root_pointer.parsed_location_name,
    pointerMrfUrl: proof.official_root_pointer.parsed_mrf_url,
    pointerHttpStatus: proof.official_root_pointer.status,
    pointerResponseContentType: proof.official_root_pointer.content_type,
    pointerResponseBytes: proof.official_root_pointer.response_bytes,
    pricingToolUrl: proof.publisher_pricing_page.url,
    browserPageObservedAt: proof.observed_at,
    browserPageStatus: proof.publisher_pricing_page.status,
    officialPricingPageUrl: proof.official_source_page.url,
    officialPricingPageStatus: proof.official_source_page.status,
    url: proof.mrf.url,
    finalUrl: proof.mrf.url,
    http_status: proof.mrf.status,
    checked_at: proof.observed_at,
    date: proof.mrf.declared_metadata.last_updated_on_normalized,
    declaredDateRaw: proof.mrf.declared_metadata.last_updated_on_raw,
    version: proof.mrf.declared_metadata.version,
    declared_hospital_name: proof.mrf.declared_metadata.hospital_name,
    location_name: proof.mrf.declared_metadata.location_name,
    declared_address: proof.mrf.declared_metadata.hospital_address,
    declared_license_number: proof.mrf.declared_metadata.license_number,
    declared_license_state: proof.mrf.declared_metadata.license_state,
    declared_npi: proof.mrf.declared_metadata.type_2_npi.join('|'),
    file_kind: 'csv',
    fileSha256: proof.mrf.complete_file_sha256,
    fullFileBytes: proof.mrf.complete_file_bytes_streamed,
    fileSampleSha256: proof.mrf.retained_sample.sha256,
    fileSampleBytes: proof.mrf.retained_sample.bytes,
    parsedDataRows: proof.mrf.csv_structure_and_usability.parsed_pricing_data_rows,
    headerColumns: proof.mrf.csv_structure_and_usability.header_columns,
    dataRowWidths: proof.mrf.csv_structure_and_usability.data_row_widths,
    rowsWithGrossCharge: proof.mrf.csv_structure_and_usability.data_rows_with_gross_charge,
    rowsWithPayer: proof.mrf.csv_structure_and_usability.data_rows_with_payer,
    rowsWithNegotiatedDollar: proof.mrf.csv_structure_and_usability.data_rows_with_negotiated_dollar,
    attestationPresent: proof.mrf.declared_metadata.attestation,
    attesterNamePresent: proof.mrf.declared_metadata.attester_name_present,
    observedFinding: 'date-within-365-days-version-3',
    rootPointerUrl: proof.official_root_pointer.url,
    rootPointerSha256: proof.official_root_pointer.response_sha256,
    rootPointerResponseBytes: proof.official_root_pointer.response_bytes,
    cmsProviderRecordUrl: proof.cms_provider_record.url,
    cmsProviderRecordSha256: proof.cms_provider_record.response_sha256,
    npiRegistryRecordSha256s: proof.cms_npi_registry_records.map(item => item.response_sha256),
    portalUpdateLabel: proof.publisher_pricing_page.page_update_label,
    httpLastModified: proof.mrf.http_last_modified,
    completeFileRetained: false
  },
  evidence_run: 'mason-general-hospital-current-root-pointer-full-mrf-2026-09-29',
  reviewed_at: proof.observed_at,
  note: proof.interpretation
});
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
manual.records.push({
  ccn: proof.ccn,
  observed_at: proof.observed_at,
  proof_file: proofName,
  official_site: `https://${proof.official_domain}/`,
  official_pricing_page: proof.official_source_page.url,
  official_pricing_page_status: proof.official_source_page.status,
  official_pricing_page_response_bytes: proof.official_source_page.response_body_utf8_bytes,
  publisher_pricing_page: proof.publisher_pricing_page.url,
  publisher_pricing_page_status: proof.publisher_pricing_page.status,
  publisher_pricing_page_response_bytes: proof.publisher_pricing_page.response_body_utf8_bytes,
  official_root_pointer_url: proof.official_root_pointer.url,
  pointer_url: proof.official_root_pointer.url,
  pointer_status: proof.official_root_pointer.status,
  pointer_bytes: proof.official_root_pointer.response_bytes,
  pointer_sha256: proof.official_root_pointer.response_sha256,
  pointer_location_name: proof.official_root_pointer.parsed_location_name,
  pointer_source_page_url: proof.official_root_pointer.parsed_source_page_url,
  facility_file_url: proof.mrf.url,
  file_status: proof.mrf.status,
  facility_file_status: proof.mrf.status,
  file_content_type: proof.mrf.content_type,
  file_bytes: proof.mrf.complete_file_bytes_streamed,
  file_sha256: proof.mrf.complete_file_sha256,
  facility_file_sample_bytes: proof.mrf.retained_sample.bytes,
  facility_file_sample_sha256: proof.mrf.retained_sample.sha256,
  file_sample_bytes: proof.mrf.retained_sample.bytes,
  file_sample_sha256: proof.mrf.retained_sample.sha256,
  retained_sample_path: proof.mrf.retained_sample.path,
  file_range_status: 200,
  file_retrieval_scope: 'complete-file-streamed; initial-262144-byte-range-retained',
  full_file_validated: true,
  full_file_bytes: proof.mrf.complete_file_bytes_streamed,
  full_file_sha256: proof.mrf.complete_file_sha256,
  declared_hospital_name: proof.mrf.declared_metadata.hospital_name,
  declared_location_name: proof.mrf.declared_metadata.location_name,
  declared_address: proof.mrf.declared_metadata.hospital_address,
  declared_license_number: proof.mrf.declared_metadata.license_number,
  declared_license_state: proof.mrf.declared_metadata.license_state,
  declared_npi: proof.mrf.declared_metadata.type_2_npi.join('|'),
  declared_last_updated: proof.mrf.declared_metadata.last_updated_on_raw,
  declared_last_updated_normalized: proof.mrf.declared_metadata.last_updated_on_normalized,
  cms_template_version: proof.mrf.declared_metadata.version,
  attestation: proof.mrf.declared_metadata.attestation,
  parsed_data_rows: proof.mrf.csv_structure_and_usability.parsed_pricing_data_rows,
  data_rows_with_description: proof.mrf.csv_structure_and_usability.data_rows_with_description,
  data_rows_with_gross_charge: proof.mrf.csv_structure_and_usability.data_rows_with_gross_charge,
  data_rows_with_payer: proof.mrf.csv_structure_and_usability.data_rows_with_payer,
  data_rows_with_negotiated_dollar: proof.mrf.csv_structure_and_usability.data_rows_with_negotiated_dollar,
  csv_header_columns: proof.mrf.csv_structure_and_usability.header_columns,
  csv_data_row_widths: proof.mrf.csv_structure_and_usability.data_row_widths,
  cms_record: proof.cms_provider_record.record,
  cms_record_sha256: proof.cms_provider_record.response_sha256,
  npi_registry_record_summaries: proof.cms_npi_registry_records.map(item => ({
    npi: item.npi,
    organization_name: item.organization_name,
    doing_business_as: item.doing_business_as,
    status: item.status_value,
    last_updated: item.last_updated,
    primary_location: item.primary_location,
    primary_taxonomy: item.primary_taxonomy,
    response_sha256: item.response_sha256
  })),
  portal_update_label: proof.publisher_pricing_page.page_update_label,
  file_last_modified: proof.mrf.http_last_modified,
  disposition: proof.disposition,
  manual_identity_gate: 'exact-current-root-pointer-file-link-full-file-sha-cms-ccn-address-npi-license-state-date-version-attestation-and-usable-rows',
  next_action: proof.next_action,
  interpretation: proof.interpretation,
  pointer_contact_fields: 'Withheld from retained proof.'
});
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn)
  || String(a.observed_at || '').localeCompare(String(b.observed_at || '')));
fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);

const browserPath = path.join(audit, 'nationwide-browser-reviews.json');
const browser = JSON.parse(fs.readFileSync(browserPath, 'utf8'));
browser.records.push({
  kind: 'official-pointer-full-mrf-retrieval',
  ccn: proof.ccn,
  target: proof.official_root_pointer.url,
  final_url: proof.mrf.url,
  status: 'current-root-pointer-and-exact-declared-mrf-retrieved',
  title: 'Mason Health disclosure and Mason General Hospital machine-readable file',
  detail: `The first-party Mason Health disclosure page returned HTTP 200 and linked the Mason General pricing page; the current root pointer returned HTTP 200 and declared the exact CSV URL below. The complete ${proof.mrf.complete_file_bytes_streamed}-byte CSV was streamed and hash-bound, with ${proof.mrf.csv_structure_and_usability.parsed_pricing_data_rows} pricing rows, all with 33 columns and non-empty description, gross charge, payer and negotiated-dollar values. Its header names Public Hospital District No 1 of Mason County / Mason General Hospital, Shelton WA, license PH60008883, CMS 3.0.0, March 10 2026 and an affirmative attestation. CMS CCN 501336 and three active NPI records match the legal entity and address. The full file was not retained locally; a 262144-byte sample is retained. The pricing-page 07/08/26 label and HTTP Last-Modified July 28 2026 remain distinct from the declared MRF date. No legal compliance conclusion is made.`,
  browser: 'web page open, in-app browser attempt, and bounded direct HTTP retrieval',
  http_status: 200,
  bytes_read: proof.mrf.complete_file_bytes_streamed,
  identity: 'exact-current-root-pointer-cms-ccn-npi-and-full-file-identity-corroborated',
  declared_hospital_name: proof.mrf.declared_metadata.hospital_name,
  declared_location_name: proof.mrf.declared_metadata.location_name,
  declared_address: proof.mrf.declared_metadata.hospital_address,
  declared_license_state: proof.mrf.declared_metadata.license_state,
  declared_last_updated: proof.mrf.declared_metadata.last_updated_on_raw,
  cms_template_version: proof.mrf.declared_metadata.version,
  observed_at: proof.observed_at,
  source_page_url: proof.official_source_page.url,
  pricing_tool_url: proof.publisher_pricing_page.url,
  pointer_url: proof.official_root_pointer.url,
  mrf_url: proof.mrf.url,
  file_sha256: proof.mrf.complete_file_sha256,
  file_sample_sha256: proof.mrf.retained_sample.sha256,
  proof_file: proofName,
  next_action: proof.next_action
});
browser.updated_at = proof.observed_at;
fs.writeFileSync(browserPath, `${JSON.stringify(browser, null, 2)}\n`);

const bytePath = path.join(audit, 'nationwide-file-byte-proof.json');
const byteProof = JSON.parse(fs.readFileSync(bytePath, 'utf8'));
if (byteProof.records.some(item => item.url === proof.mrf.url && item.ccns?.includes(proof.ccn)))
  throw new Error('Mason General byte proof already exists; review rather than duplicate');
byteProof.records.push({
  url: proof.mrf.url,
  ccns: [proof.ccn],
  checked_at: proof.observed_at,
  final_url: proof.mrf.url,
  http_status: proof.mrf.retained_sample.status,
  requested_range: proof.mrf.retained_sample.content_range,
  bytes_retained: proof.mrf.retained_sample.bytes,
  sha256: proof.mrf.retained_sample.sha256,
  raw_artifact: proof.mrf.retained_sample.path,
  content_type: proof.mrf.content_type,
  complete_file_http_status: proof.mrf.status,
  complete_file_bytes_streamed: proof.mrf.complete_file_bytes_streamed,
  complete_file_sha256: proof.mrf.complete_file_sha256,
  complete_file_etag: proof.mrf.etag,
  complete_file_last_modified: proof.mrf.http_last_modified,
  parsed_data_rows: proof.mrf.csv_structure_and_usability.parsed_pricing_data_rows,
  full_file_validation: 'streamed-complete; consistent-33-column-records; descriptions-gross-charges-payers-and-negotiated-dollar-fields-present-in-all-pricing-rows',
  parsed_root_candidates: [{
    fileKind: 'csv',
    innerKind: 'csv',
    declaredLastUpdated: proof.mrf.declared_metadata.last_updated_on_normalized,
    declaredLastUpdatedRaw: proof.mrf.declared_metadata.last_updated_on_raw,
    cmsVersion: proof.mrf.declared_metadata.version,
    mrfHospitalName: proof.mrf.declared_metadata.hospital_name,
    mrfLocationName: proof.mrf.declared_metadata.location_name,
    mrfAddress: proof.mrf.declared_metadata.hospital_address,
    mrfLicenseState: proof.mrf.declared_metadata.license_state,
    mrfLicenseNumber: proof.mrf.declared_metadata.license_number,
    mrfNpi: proof.mrf.declared_metadata.type_2_npi.join('|'),
    attestation: proof.mrf.declared_metadata.attestation
  }],
  error: '',
  final_host: new URL(proof.mrf.url).hostname,
  full_file_retained: false,
  proof_file: proofName
});
byteProof.records.sort((a, b) => String(a.url).localeCompare(String(b.url))
  || String(a.checked_at).localeCompare(String(b.checked_at)));
fs.writeFileSync(bytePath, `${JSON.stringify(byteProof, null, 2)}\n`);

console.log(JSON.stringify({
  ccn: proof.ccn,
  finding: 'verified-current-mrf',
  completeBytes: proof.mrf.complete_file_bytes_streamed,
  completeSha256: proof.mrf.complete_file_sha256,
  retainedSampleBytes: proof.mrf.retained_sample.bytes,
  retainedSampleSha256: proof.mrf.retained_sample.sha256,
  parsedDataRows: proof.mrf.csv_structure_and_usability.parsed_pricing_data_rows,
  ledgerEntries: ledger.length,
  manualObservationsForCcn: manual.records.filter(item => item.ccn === proof.ccn).length,
  fileProofEntriesForCcn: byteProof.records.filter(item => item.ccns?.includes(proof.ccn)).length
}, null, 2));
