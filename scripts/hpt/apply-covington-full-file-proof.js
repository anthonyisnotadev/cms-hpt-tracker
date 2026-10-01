'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-covington-smith-current-pointer-file-proof-2026-09-30.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const full = proof.current_mrf_full_file_review;
if (proof.ccn_dispositions['251325']?.disposition !== 'verified-current-mrf'
  || full?.bytes_received !== 93493711
  || full?.sha256 !== '962080aef2ea163adfe3c9b9005cb35dcea20e801ab031b9495e3bcea8c74886'
  || full?.cms_validator?.package !== '@cmsgov/hpt-validator-cli'
  || full.cms_validator.version !== '1.10.8'
  || full.cms_validator.requirements !== 'v3.0'
  || full.cms_validator.valid !== true
  || full.cms_validator.error_count !== 0 || full.cms_validator.alert_count !== 0
  || full.csv_validation?.data_rows !== 266930
  || full.csv_validation?.malformed_row_widths !== 0) {
  throw new Error('Covington full-file proof is incomplete or changed; review before applying');
}

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manualDoc = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const previous = [...manualDoc.records].reverse().find(record => record.ccn === '251325'
  && record.latest_pointer_recheck);
if (!previous || previous.proof_file !== proofName
  || previous.latest_pointer_recheck?.pointer_sha256 !== proof.pointer_observation.sha256) {
  throw new Error('Covington manual observation/pointer no longer matches exact proof');
}
const observedAt = full.observed_at;
const { latest_pointer_recheck: _historicalPointerRecheck, ...previousWithoutHistoricalRecheck } = previous;
const fullObservation = {
  ...previousWithoutHistoricalRecheck,
  observed_at: observedAt,
  pointer_status: proof.pointer_observation.http_status,
  pointer_sha256: proof.pointer_observation.sha256,
  file_sample_bytes: proof.current_mrf_header_sample.sample_bytes,
  file_sample_sha256: proof.current_mrf_header_sample.sample_sha256,
  file_kind: 'text/csv',
  full_file_validated: true,
  file_range_status: full.http_status,
  file_bytes: full.bytes_received,
  full_file_bytes: full.bytes_received,
  file_sha256: full.sha256,
  full_file_sha256: full.sha256,
  parsed_data_rows: full.csv_validation.data_rows,
  data_rows_with_description: full.csv_validation.nonempty_description_rows,
  data_rows_with_gross_charge: full.csv_validation.rows_with_gross_charge,
  data_rows_with_payer: full.csv_validation.rows_with_payer,
  data_rows_with_usable_negotiated_charge: full.csv_validation.rows_with_negotiated_charge,
  csv_header_columns: full.csv_validation.header_columns,
  csv_data_row_widths: [full.csv_validation.header_columns],
  cms_validator: {
    package: full.cms_validator.package,
    version: full.cms_validator.version,
    requirements: full.cms_validator.requirements,
    format: full.cms_validator.format,
    valid: full.cms_validator.valid,
    error_count: full.cms_validator.error_count,
    alert_count: full.cms_validator.alert_count
  },
  latest_full_file_review: {
    proof_sha256: full.sha256,
    bytes: full.bytes_received,
    validator: 'CMS official HPT validator CLI 1.10.8, requirements v3.0',
    valid: true,
    errors: 0,
    alerts: 0
  },
  disposition: 'verified-current-mrf',
  manual_disposition: 'verified-current-mrf',
  manual_identity_gate: 'current-root-pointer-exact-file-full-bytes-header-name-address-state-date-attestation-agree',
  next_action: 'Retain the raw publisher location_name suffix in the tracker and monitor for a publisher correction/current file update; do not normalize the source value or transfer this file to CCN 250786.'
};
const existingIndex = manualDoc.records.findIndex(record => record.ccn === '251325'
  && record.observed_at === observedAt);
if (existingIndex >= 0) manualDoc.records[existingIndex] = fullObservation;
else manualDoc.records.push(fullObservation);
fs.writeFileSync(manualPath, `${JSON.stringify(manualDoc, null, 2)}\n`);

const resolutionPath = path.join(audit, 'reviewed-resolutions.json');
const resolutions = JSON.parse(fs.readFileSync(resolutionPath, 'utf8'));
const resolution = resolutions.find(record => record.ccn === '251325');
if (!resolution || !['replace-observation', 'replace'].includes(resolution.action))
  throw new Error('Expected historical Covington replace-observation resolution is missing');
resolution.action = 'replace';
resolution.evidence = {
  ...resolution.evidence,
  identity: 'corroborated',
  identityBasis: 'current-first-party-pricing-page-and-complete-root-pointer-link-exact-file-full-csv-cms-v3-validation',
  pointerUrl: proof.pointer_observation.url,
  pointerSha256: proof.pointer_observation.sha256,
  pointerHttpStatus: proof.pointer_observation.http_status,
  pointerIssue: 'current-root-pointer-and-page-link-exact-mrf',
  pointerMrfUrl: full.url,
  url: full.url,
  http_status: full.http_status,
  checked_at: observedAt,
  date: '2026-07-21',
  version: '3.0.0',
  officialDomain: 'covingtoncountyhospital.com',
  location_name: 'covington_county_hospital_.1',
  declared_hospital_name: 'covington_county_hospital',
  declared_address: '701_south_holly_avenue_collins_ms_39428',
  declared_license_state: 'MS',
  declared_license_number: '11181',
  declared_npi: '1215965249',
  file_kind: 'csv',
  fileSha256: full.sha256,
  fullFileSha256: full.sha256,
  fullFileBytes: full.bytes_received,
  completeFileValidated: true,
  csvDataRows: full.csv_validation.data_rows,
  csvHeaderColumns: full.csv_validation.header_columns,
  csvMalformedRowWidths: full.csv_validation.malformed_row_widths,
  csvUsableChargeRows: full.csv_validation.rows_with_negotiated_charge,
  cmsValidator: {
    package: full.cms_validator.package,
    version: full.cms_validator.version,
    requirements: full.cms_validator.requirements,
    format: full.cms_validator.format,
    valid: full.cms_validator.valid,
    errors: full.cms_validator.error_count,
    alerts: full.cms_validator.alert_count
  },
  observedFinding: 'verified-current-mrf',
  next_action: 'Retain the raw publisher location_name suffix in the tracker and monitor for a publisher correction/current file update; do not normalize the source value or transfer this file to CCN 250786.'
};
resolution.evidence_run = 'covington-current-root-pointer-full-csv-cms-v3-validated-2026-09-30';
resolution.reviewed_at = observedAt;
resolution.note = 'Current first-party pricing page and complete current root pointer identify the exact CSV. Full file hash, 29-column/266,930-row structure and charge-presence review are retained. CMS official HPT validator CLI 1.10.8, requirements v3.0, reports zero errors and zero alerts. Header name, Collins address, Mississippi license/state and NPI agree with CCN 251325. Preserve the publisher location_name literally as covington_county_hospital_.1. This is current MRF verification, not a legal compliance or line-item accuracy determination. Earlier 2026-09-16 pointer-unavailable observation remains historical evidence.';
fs.writeFileSync(resolutionPath, `${JSON.stringify(resolutions, null, 2)}\n`);

console.log(JSON.stringify({ ccn: '251325', finding: 'verified-current-mrf', bytes: full.bytes_received,
  sha256: full.sha256, dataRows: full.csv_validation.data_rows, cmsErrors: 0, cmsAlerts: 0 }));
