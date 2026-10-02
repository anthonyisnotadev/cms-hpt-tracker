'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-valley-regional-pointer-alias-reconciliation-proof-2026-10-01.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const ccn = p.ccn;
const observedAt = p.observed_at;

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn,
  observed_at: observedAt,
  proof_file: proofName,
  official_domain: 'https://valleyregionalmedicalcenter.com/',
  pointer_url: 'https://valleyregionalmedicalcenter.com/cms-hpt.txt',
  pointer_status: p.pointer_observation.http_status,
  pointer_sha256: p.pointer_observation.sha256,
  pointer_entry_count: p.pointer_observation.entry_count,
  pointer_entries_matching_facility: p.pointer_observation.entries_matching_facility,
  pointer_location_name: 'VALLEY REGIONAL MEDICAL CENTER',
  pointer_declared_mrf_url: p.pointer_observation.pointer_declared_mrf_url,
  facility_file_url: p.pointer_observation.pointer_declared_mrf_url,
  file_status: 206,
  file_sample_bytes: p.file_observation.sample_bytes,
  file_sample_sha256: p.file_observation.sample_sha256,
  declared_hospital_name: p.file_observation.declared_hospital_name,
  declared_location_name: p.file_observation.declared_hospital_name,
  declared_address: '100 A ALTON GLOOR, BROWNSVILLE, TX, 78526',
  declared_type_2_npis: p.file_observation.declared_type_2_npis,
  declared_license_state: 'TX',
  declared_last_updated: '2026-09-01',
  cms_template_version: p.file_observation.cms_template_version,
  attestation: true,
  file_kind: 'json',
  manual_identity: 'corroborated',
  manual_identity_gate: 'pointer-entries-all-facility-file-header-address-state-nppes-npi-v3-date-attestation-agree-bounded-sample',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the updated three-entry pointer chain (hospital plus two ER aliases, all to the same MRF); recheck on the next publisher pointer or file change. Full-file hash remains unestablished (bounded 262,144-byte header sample of the 391,910,079-byte JSON).'
};

manual.records = manual.records.filter((x) => x.ccn !== ccn);
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ccn, disposition: record.disposition }, null, 2));
