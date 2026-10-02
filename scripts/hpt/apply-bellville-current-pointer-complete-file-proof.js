'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-bellville-current-pointer-complete-file-proof-2026-10-01.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const ccn = p.ccn;
const observedAt = p.observed_at;

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn,
  observed_at: observedAt,
  proof_file: proofName,
  official_domain: 'https://midcoasthealthsystem.org/',
  pointer_url: 'https://midcoasthealthsystem.org/cms-hpt.txt',
  pointer_status: p.pointer_observation.http_status,
  pointer_sha256: p.pointer_observation.sha256,
  pointer_entry_count: p.pointer_observation.entry_count,
  pointer_entries_matching_facility: p.pointer_observation.entries_matching_facility,
  pointer_location_name: p.pointer_observation.pointer_location_name,
  pointer_declared_mrf_url: p.pointer_observation.pointer_declared_mrf_url_decoded,
  facility_file_url: p.file_observation.mrf_url,
  file_status: p.file_observation.http_status,
  file_total_bytes: p.file_observation.total_bytes,
  file_sha256: p.file_observation.sha256_complete_file,
  declared_hospital_name: p.file_observation.declared_hospital_name,
  declared_location_name: p.file_observation.declared_location_name,
  declared_address: p.file_observation.declared_address,
  declared_type_2_npis: p.file_observation.declared_type_2_npis,
  declared_license_state: 'TX',
  declared_last_updated: '2026-06-01',
  cms_template_version: p.file_observation.cms_template_version,
  attestation: true,
  file_kind: 'csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'pointer-entry-complete-bytes-cms-address-state-nppes-npi-v3-date-attestation-agree-single-matching-entry',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the updated pointer-to-WideCSV chain and the consistent TallCSV lead; recheck on the next publisher pointer or file change. The superseded 2025-06-01 v2.0.0 file and the unrelated New York St Josephs pointer remain history.'
};

manual.records = manual.records.filter((x) => x.ccn !== ccn);
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ccn, disposition: record.disposition, bytes: p.file_observation.total_bytes }, null, 2));
