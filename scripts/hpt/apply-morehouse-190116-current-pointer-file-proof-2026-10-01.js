'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const ccn = '190116';
const record = {
  ccn,
  observed_at: '2026-10-01T20:48:00.000Z',
  proof_file: 'reconciliation-morehouse-current-pointer-file-proof-2026-10-01.json',
  official_domain: 'https://www.mghospital.com/',
  official_facility_name: 'MOREHOUSE GENERAL HOSPITAL',
  official_facility_address: '323 W WALNUT, BASTROP, LA 71220',
  pointer_url: 'https://mghospital.com/cms-hpt.txt',
  pointer_status: 200,
  pointer_sha256: '67118e6742dd3b2fcb3e0c7b6d64b391079f5fb58308ca72e0e8bd59c7b72690',
  pointer_location_name: 'Morehouse General Hospital',
  pointer_declared_mrf_url: 'https://morehousegeneralhospital.pg.quadax.revenuemasters.com/cdm-files/726011528_morehouse-general-hospital_standardcharges.csv',
  pointer_entry_count: 1,
  pointer_entries_matching_facility: 1,
  facility_file_url: 'https://morehousegeneralhospital.pg.quadax.revenuemasters.com/cdm-files/726011528_morehouse-general-hospital_standardcharges.csv',
  file_status: 200,
  file_bytes: 21853747,
  file_sample_bytes: 262144,
  file_sample_sha256: '232a558c86d33cfe9cbe6a840c79fd827cd185269b8248aa7faaba6668a0aee2',
  declared_hospital_name: 'Morehouse General Hospital',
  declared_location_name: 'Morehouse General Hospital',
  declared_address: '323 W. Walnut Avenue Bastrop, LA 71220',
  declared_license_number: '167',
  declared_license_state: 'LA',
  declared_type_2_npis: '1003898313',
  declared_last_updated: '2026-03-31',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  pointer_transport_note: 'Pointer retrieved via web-reader MCP past the sgcaptcha automation wall; pointer_sha256 is of the reader-extracted pointer text. File identity/metadata taken from the bounded 262,144-byte head sample of the 21,853,747-byte CSV (sample sha256 recorded separately); rate rows beyond the sample were not audited.',
  manual_identity: 'corroborated',
  manual_identity_gate: 'exact-pointer-file-name-address-state-v3-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the pointer/file chain; optional later full-file rate-level validation.'
};
manual.records = manual.records.filter((x) => x.ccn !== ccn);
manual.records.push(record);
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ccn, disposition: record.disposition }, null, 2));
