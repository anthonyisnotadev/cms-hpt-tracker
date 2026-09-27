'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-community-medical-center-claraprice-full-recheck-proof-2026-09-25.json';
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
  facility_file_url: proof.facility_file_url,
  file_range_status: 200,
  file_sample_bytes: proof.retrieval.bytes,
  file_sample_sha256: proof.retrieval.sha256.toLowerCase(),
  file_bytes: proof.retrieval.bytes,
  file_sha256: proof.retrieval.sha256.toLowerCase(),
  declared_hospital_name: proof.declared_hospital_name,
  declared_location_name: proof.declared_location_name.join(' | '),
  declared_address: proof.declared_address.join(' | '),
  declared_license_number: proof.declared_license_number,
  declared_license_state: proof.declared_license_state,
  declared_npi: proof.declared_npi.join(' | '),
  declared_last_updated: proof.declared_last_updated,
  cms_template_version: proof.cms_template_version,
  attestation: proof.attestation,
  usable_rows_observed: true,
  manual_identity_gate: 'exact-facility-name-address-state-npi-license-state-agree',
  disposition: proof.disposition,
  interpretation: proof.interpretation,
  next_action: proof.next_action,
  prior_observation: prior.proof_file === proofName
    ? prior.prior_observation
    : { observed_at: prior.observed_at, proof_file: prior.proof_file, disposition: prior.disposition },
};
document.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(file, JSON.stringify(document, null, 2) + '\n');
console.log(JSON.stringify({ updated: proof.ccn, disposition: proof.disposition, bytes: proof.retrieval.bytes }, null, 2));
