'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-mad-river-current-pointer-file-proof-2026-09-25.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const file = path.join(audit, 'reconciliation-manual-access-observations.json');
const document = JSON.parse(fs.readFileSync(file, 'utf8'));
const index = document.records.findIndex(record => record.ccn === proof.ccn);
if (index < 0) throw new Error(`missing manual observation for ${proof.ccn}`);
const prior = document.records[index];
document.records[index] = {
  ...prior,
  observed_at: proof.observed_at,
  proof_file: proofName,
  official_site: proof.official_site,
  pointer_url: proof.pointer_url,
  pointer_http_status: proof.pointer_http_status,
  pointer_bytes: proof.pointer_bytes,
  pointer_sha256: proof.pointer_sha256,
  source_page_url: proof.declared_source_page_url,
  mrf_url: proof.declared_mrf_url,
  // These normalized fields are consumed by build-nationwide-verification.js
  // when turning a dated manual proof into the canonical nationwide overlay.
  facility_file_url: proof.declared_mrf_url,
  pointer_status: proof.pointer_http_status,
  file_range_status: proof.mrf_http_status,
  file_sample_bytes: proof.mrf_sample_bytes,
  file_sample_sha256: proof.mrf_sample_sha256,
  pointer_browser_status: 'retrieved',
  candidate_file_url: proof.declared_mrf_url,
  candidate_file_http_status: proof.mrf_http_status,
  candidate_file_content_length: proof.mrf_content_length,
  candidate_file_range_bytes: proof.mrf_sample_bytes,
  candidate_file_range_sha256: proof.mrf_sample_sha256,
  mrf_http_status: proof.mrf_http_status,
  mrf_content_length: proof.mrf_content_length,
  mrf_sample_bytes: proof.mrf_sample_bytes,
  mrf_sample_sha256: proof.mrf_sample_sha256,
  declared_hospital_name: proof.declared_hospital_name,
  declared_location_name: proof.declared_location_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_license_state,
  declared_npi: proof.declared_npi,
  declared_last_updated: proof.declared_last_updated,
  cms_template_version: proof.cms_template_version,
  attestation: proof.attestation,
  usable_rows_observed: proof.usable_rows_observed,
  manual_identity_gate: 'exact-facility-name-address-state-date-version-attestation-and-usable-rows',
  disposition: proof.disposition,
  interpretation: proof.interpretation,
  next_action: 'Retain the exact pointer and bounded file provenance; recheck the full file only after a material file/date change.',
  prior_observation: prior.proof_file === proofName ? prior.prior_observation : {
    observed_at: prior.observed_at,
    proof_file: prior.proof_file,
    disposition: prior.disposition,
  },
};
document.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(file, JSON.stringify(document, null, 2) + '\n');
console.log(JSON.stringify({ updated: proof.ccn, disposition: proof.disposition }, null, 2));
