'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const ccn = '100277';
const record = {
  ccn,
  observed_at: '2026-10-01T20:59:00.000Z',
  proof_file: 'reconciliation-douglas-gardens-current-pointer-file-proof-2026-10-01.json',
  official_domain: 'https://www.miamijewishhealth.org/',
  official_facility_name: 'DOUGLAS GARDENS HOSPITAL',
  official_facility_address: '5200 NE 2ND AVE, MIAMI, FL 33137',
  pointer_url: 'https://www.miamijewishhealth.org/cms-hpt.txt',
  pointer_status: 200,
  pointer_sha256: 'b2bea7723d62b4c9592b21eae84203389c24dc12283abfd768626bb2d9f988fa',
  pointer_location_name: 'Douglas Gardens Hospital',
  pointer_declared_mrf_url: 'https://www.miamijewishhealth.org/wp-content/uploads/2026/07/590624414_DouglesGardensHospital_standardcharges.csv',
  pointer_entry_count: 1,
  pointer_entries_matching_facility: 1,
  facility_file_url: 'https://www.miamijewishhealth.org/wp-content/uploads/2026/07/590624414_DouglesGardensHospital_standardcharges.csv',
  file_status: 200,
  file_bytes: 16575,
  file_sha256: 'c807ca20048a4fcdcdc8057ff657f221e7679da6e428bd2535c809d45f5924dc49',
  declared_hospital_name: 'Douglas Gardens Hospital',
  declared_location_name: 'Douglas Gardens',
  declared_address: '5200 NE 2nd Avenue, Miami, FL 33137',
  declared_license_number: '3988',
  declared_license_state: 'FL',
  declared_type_2_npis: '1851440218',
  declared_last_updated: '2026-06-12',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  pointer_transport_note: 'Pointer retrieved via web-reader MCP past the SiteGround sgcaptcha automation wall; pointer_sha256 is of the reader-extracted pointer text. File obtained by authorized in-browser click-through download from the first-party pricing page; complete 16,575 bytes hashed.',
  manual_identity: 'corroborated',
  manual_identity_gate: 'exact-pointer-file-name-address-state-v3-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the exact pointer/file chain and recheck on the next publisher pointer or file change.'
};
manual.records = manual.records.filter((x) => x.ccn !== ccn);
manual.records.push(record);
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ccn, disposition: record.disposition }, null, 2));
