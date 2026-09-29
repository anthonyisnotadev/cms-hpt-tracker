'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-roger-williams-current-page-file-proof-2026-09-28.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const observationsPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const observations = JSON.parse(fs.readFileSync(observationsPath, 'utf8'));
const index = observations.records.findIndex(record => record.ccn === proof.ccn);
if (index < 0) throw new Error(`Missing manual observation for ${proof.ccn}`);
const prior = observations.records[index];
if (Date.parse(prior.observed_at || '1970-01-01') > Date.parse(proof.observed_at)) {
  throw new Error(`Refusing to replace a newer manual observation for ${proof.ccn}`);
}

observations.records[index] = {
  ...prior,
  observed_at: proof.observed_at,
  proof_file: proofName,
  official_site: proof.official_site,
  official_pricing_page: proof.official_pricing_page,
  official_identity: proof.official_identity,
  page_file_link: proof.official_page_file_link,
  page_file_link_role: 'Current first-party CharterCARE price-transparency page links this HPI download page; HPI displays the facility-specific full CSV download link.',
  download_page: proof.download_page,
  facility_file_url: proof.facility_file_url,
  page_file_url: proof.facility_file_url,
  publisher_file_url: proof.facility_file_url,
  file_status: proof.file_status,
  publisher_file_status: proof.file_status,
  file_content_type: proof.file_content_type,
  publisher_file_content_type: proof.file_content_type,
  file_bytes: proof.file_bytes,
  publisher_file_total_bytes: proof.file_bytes,
  file_sha256: proof.file_sha256,
  publisher_file_sample_sha256: proof.file_sha256,
  file_last_modified: proof.file_last_modified,
  file_etag: proof.file_etag,
  declared_hospital_name: proof.declared_hospital_name,
  declared_location_name: proof.declared_location_name,
  declared_address: proof.declared_address,
  declared_license_number: proof.declared_license_number,
  declared_license_state: proof.declared_license_state,
  declared_npi: proof.declared_npi,
  declared_last_updated: proof.declared_last_updated,
  cms_template_version: proof.cms_template_version,
  attestation: proof.attestation,
  logical_csv_rows: proof.logical_csv_rows,
  nonblank_rate_rows: proof.nonblank_rate_rows,
  rows_with_negotiated_dollar_amount: proof.rows_with_negotiated_dollar_amount,
  usable_rows_observed: proof.usable_rows_observed,
  manual_identity_gate: proof.manual_identity_gate,
  disposition: proof.disposition,
  interpretation: proof.interpretation,
  pointer_url: '',
  next_action: proof.next_action
};
observations.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(observationsPath, `${JSON.stringify(observations, null, 2)}\n`);
console.log(JSON.stringify({ ccn: proof.ccn, proof_file: proofName, disposition: proof.disposition,
  file_bytes: proof.file_bytes, file_sha256: proof.file_sha256 }, null, 2));
