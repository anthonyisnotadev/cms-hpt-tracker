'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const ccn = '234045';
const record = {
  ccn,
  observed_at: '2026-10-01T20:38:30.000Z',
  proof_file: 'reconciliation-metropolitanbh-current-pointer-file-proof-2026-10-01.json',
  official_domain: 'https://metropolitanbh.com/',
  official_facility_name: 'METROPOLITAN BEHAVIORAL HEALTH',
  official_facility_address: '18001 ROTUNDA DRIVE, DEARBORN, MI 48124',
  pointer_url: 'https://metropolitanbh.com/cms-hpt.txt',
  pointer_status: 200,
  pointer_sha256: null,
  pointer_location_name: 'Metropolitan Behavioral Health',
  pointer_declared_mrf_url: 'https://uhsfilecdn.eskycity.net/bh/831978365_metropolitan_standardcharges.csv',
  pointer_entry_count: 1,
  pointer_entries_matching_facility: 1,
  facility_file_url: 'https://uhsfilecdn.eskycity.net/bh/831978365_metropolitan_standardcharges.csv',
  file_status: 200,
  file_bytes: 19327,
  file_sha256: '641d727d81fb9523ebae342a0b4b8f25c4c559599c700870fadc85d704b9f104',
  declared_hospital_name: 'Metropolitan Behavioral Health',
  declared_location_name: 'Metropolitan Behavioral Health',
  declared_address: '18001 ROTUNDA DR., DEARBORN, MI 48124',
  declared_license_number: '1080000056',
  declared_license_state: 'MI',
  declared_type_2_npis: '1164091799',
  declared_last_updated: '2026-05-14',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  pointer_transport_note: 'Pointer retrieved via web-reader MCP; curl remains Cloudflare-403-blocked, so no wire-byte pointer SHA-256 is available. The complete MRF was fetched directly with exact bytes and SHA-256.',
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
