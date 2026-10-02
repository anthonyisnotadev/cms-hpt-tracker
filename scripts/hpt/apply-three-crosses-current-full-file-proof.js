'use strict';

// Applies the 2026-10-01 complete-file CMS-validated verification for CCN 320091
// (Three Crosses Regional Hospital LLC). Idempotent; touches only CCN 320091.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-three-crosses-current-full-file-validated-proof-2026-10-01.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const full = proof.current_mrf_full_file_review;
if (proof.ccn !== '320091'
  || full?.bytes_received !== 62260653
  || full?.sha256 !== 'EBD45B1704EC1C1D38ECEA1D59D3320BED6DF3441E2086381932D6DB14095989'
  || full?.cms_validator?.package !== '@cmsgov/hpt-validator-cli'
  || full.cms_validator.version !== '1.10.8'
  || full.cms_validator.requirements !== 'v3.0'
  || full.cms_validator.valid !== true
  || full.cms_validator.error_count !== 0 || full.cms_validator.alert_count !== 0
  || full.csv_validation?.data_rows !== 372722
  || full.csv_validation?.malformed_row_widths !== 0) {
  throw new Error('Three Crosses full-file proof is incomplete or changed; review before applying');
}
if (proof.pointer_observation?.sha256 !== '57E6D622C5971878D51BE47E1BAF13BF82C6C7A0BA86734E044F172CEA282FDE') {
  throw new Error('Pointer hash changed; re-verify pointer before applying');
}

const observedAt = proof.observed_at;

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manualDoc = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const existingIndex = manualDoc.records.findIndex(record => record.ccn === '320091'
  && record.observed_at === observedAt
  && record.latest_full_file_review);
if (existingIndex === -1) {
  manualDoc.records.push({
    ccn: '320091',
    observed_at: observedAt,
    proof_file: proofName,
    current_official_domain: 'https://www.threecrossesregional.com/',
    latest_pointer_file_recheck: {
      pointer_status: proof.pointer_observation.http_status,
      pointer_url: 'https://www.threecrossesregional.com/cms-hpt.txt',
      pointer_sha256: proof.pointer_observation.sha256,
      mrf_url: full.url,
      mrf_status: full.http_status,
      note: 'Current first-party root pointer names the exact Hyve CSV; source page and pointer agree.'
    },
    file_sample_bytes: proof.mrf_header_sample.sample_bytes,
    file_sample_sha256: proof.mrf_header_sample.sample_sha256,
    file_kind: 'text/csv',
    full_file_validated: true,
    file_bytes: full.bytes_received,
    full_file_bytes: full.bytes_received,
    file_sha256: full.sha256,
    full_file_sha256: full.sha256,
    parsed_data_rows: full.csv_validation.data_rows,
    data_rows_with_description: full.csv_validation.nonempty_description_rows,
    data_rows_with_gross_charge: full.csv_validation.rows_with_gross_charge,
    data_rows_with_payer: full.csv_validation.rows_with_payer,
    data_rows_with_usable_negotiated_charge: full.csv_validation.rows_with_negotiated_dollar,
    csv_header_columns: full.csv_validation.header_columns,
    csv_malformed_row_widths: full.csv_validation.malformed_row_widths,
    cms_validator: {
      package: full.cms_validator.package,
      version: full.cms_validator.version,
      requirements: full.cms_validator.requirements,
      format: full.cms_validator.format,
      valid: full.cms_validator.valid,
      error_count: full.cms_validator.error_count,
      alert_count: full.cms_validator.alert_count
    },
    declared_hospital_name: full.required_header.hospital_name,
    declared_location_name: full.required_header.location_name,
    declared_address: full.required_header.hospital_address,
    declared_license_state: 'NM',
    declared_license_number: full.required_header.license_number_value,
    declared_npi: full.required_header.type_2_npi,
    declared_attestation: full.required_header.attestation,
    declared_last_updated: '2026-09-21',
    cms_template_version: full.required_header.version,
    disposition: 'verified-current-mrf',
    manual_disposition: 'verified-current-mrf',
    manual_identity_gate: proof.identity_gate,
    next_action: 'Monitor for a publisher file update; retain the 2024-11-07 CA-labeled file observation and the 2026-09-26 bounded-sample observation as dated provenance.'
  });
  fs.writeFileSync(manualPath, `${JSON.stringify(manualDoc, null, 2)}\n`);
}

const resolutionPath = path.join(audit, 'reviewed-resolutions.json');
const resolutions = JSON.parse(fs.readFileSync(resolutionPath, 'utf8'));
const base = resolutions.find(record => record.ccn === '320091');
const baseEvidence = base?.evidence || {};
const resolution = {
  ccn: '320091',
  base: base?.base || {},
  action: 'replace',
  evidence: {
    ...baseEvidence,
    identity: 'corroborated',
    identity_basis: proof.identity_gate,
    officialDomain: 'threecrossesregional.com',
    pointerUrl: proof.pointer_observation.url,
    pointerSha256: proof.pointer_observation.sha256,
    sourcePageUrl: 'https://threecrossesregional.com/price_transparency.html',
    url: full.url,
    finalUrl: full.url,
    http_status: full.http_status,
    checked_at: observedAt,
    date: '2026-09-21',
    version: '3.0.0',
    expected_version: '3.0.0',
    declared_hospital_name: full.required_header.hospital_name,
    location_name: full.required_header.location_name,
    declared_address: full.required_header.hospital_address,
    declared_license_state: 'NM',
    declared_license_number: full.required_header.license_number_value,
    declared_npi: full.required_header.type_2_npi,
    attestationPresent: true,
    file_kind: 'text/csv',
    fileSha256: full.sha256,
    fullFileSha256: full.sha256,
    fullFileBytes: full.bytes_received,
    completeFileValidated: true,
    csvDataRows: full.csv_validation.data_rows,
    csvHeaderColumns: full.csv_validation.header_columns,
    csvMalformedRowWidths: full.csv_validation.malformed_row_widths,
    csvUsableChargeRows: full.csv_validation.rows_with_negotiated_dollar,
    cmsValidator: {
      package: full.cms_validator.package,
      version: full.cms_validator.version,
      requirements: full.cms_validator.requirements,
      valid: full.cms_validator.valid,
      errors: full.cms_validator.error_count,
      alerts: full.cms_validator.alert_count
    },
    observedFinding: 'compliant-observed',
    next_action: 'Monitor for a publisher file update; retain the 2024-11-07 CA-labeled file observation and the 2026-09-26 bounded-sample observation as dated provenance.'
  },
  evidence_run: 'three-crosses-current-root-pointer-full-csv-cms-v3-validated-2026-10-01',
  reviewed_at: observedAt,
  finding: 'verified-current-mrf',
  note: 'Current first-party root pointer and source page identify the exact Hyve CSV. Complete 62,260,653-byte file retrieved and hashed; 32-column/372,722-row structure with zero malformed widths; official CMS HPT validator CLI 1.10.8 (requirements v3.0) reports valid with zero errors and zero alerts. Header name, 2560 Samaritan Dr Las Cruces NM 88001 address, NM license 3699, NPI 1760020044, attestation TRUE, date 2026-09-21 and canonical version 3.0.0 agree with CCN 320091. This resolves the prior license_number|CA metadata question: the current file labels the column license_number|NM and the token |CA does not occur in the complete file. This is current MRF verification, not a legal compliance or line-item price-accuracy determination. Older 2024-11-07 and 2026-09-26 observations remain historical evidence.'
};
const idx = resolutions.findIndex(record => record.ccn === '320091');
if (idx >= 0 && resolutions[idx]?.evidence_run === resolution.evidence_run) {
  console.log(JSON.stringify({ ccn: '320091', finding: 'verified-current-mrf', already_applied: true }));
} else {
  if (idx >= 0) resolutions[idx] = resolution; else resolutions.push(resolution);
  resolutions.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(resolutionPath, `${JSON.stringify(resolutions, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: '320091', finding: 'verified-current-mrf', bytes: full.bytes_received, sha256: full.sha256, dataRows: full.csv_validation.data_rows, cmsErrors: 0, cmsAlerts: 0 }));
}
