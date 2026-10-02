'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const ccn = '184014';
const record = {
  ccn,
  observed_at: '2026-10-01T18:51:26.470Z',
  proof_file: 'reconciliation-cumberland-hall-current-pointer-file-proof-2026-10-01.json',
  official_domain: 'https://cumberlandhallhospital.com/',
  official_facility_name: 'CUMBERLAND HALL HOSPITAL',
  official_facility_address: '270 WALTON WAY, HOPKINSVILLE, KY 42240',
  pointer_url: 'https://cumberlandhallhospital.com/cms-hpt.txt',
  pointer_status: 200,
  pointer_sha256: '0DD6DDB9141A6A92A57775076AC28DCB0E3C9A8E6C3C47BDDAC43EF7361C5477',
  pointer_location_name: 'Cumberland Hall Hospital',
  pointer_declared_mrf_url: 'https://uhsfilecdn.eskycity.net/bh/611267294_cumberland-hall_standardcharges.csv',
  pointer_entry_count: 1,
  pointer_entries_matching_facility: 1,
  facility_file_url: 'https://uhsfilecdn.eskycity.net/bh/611267294_cumberland-hall_standardcharges.csv',
  file_status: 200,
  file_bytes: 34862,
  file_sha256: '29A9C82DC75B1B9CA995C88679B48761B7A461267ECB155897BE8F3BE0FBB01B',
  declared_hospital_name: 'Cumberland Hall Hospital',
  declared_location_name: 'Cumberland Hall Hospital',
  declared_address: '270 WALTON WAY, HOPKINSVILLE, KY 42240',
  declared_license_number: '100597',
  declared_license_state: 'KY',
  declared_type_2_npis: '1750392502',
  declared_last_updated: '2026-06-10',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  pointer_transport_note: 'Pointer retrieved via web-reader MCP; curl remains Cloudflare-403-blocked, so pointer_sha256 is of reader-extracted text, not wire bytes. The complete MRF was fetched directly with exact bytes and SHA-256.',
  manual_identity: 'corroborated',
  manual_identity_gate: 'exact-pointer-file-name-address-state-v3-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the exact pointer/file chain and recheck on the next publisher pointer or file change.'
};
manual.records = manual.records.filter(x => x.ccn !== ccn);
manual.records.push(record);
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ccn, disposition: record.disposition }, null, 2));
