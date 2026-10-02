'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const ccn = '104080';
const record = {
  ccn,
  observed_at: '2026-10-01T18:41:17.182Z',
  proof_file: 'reconciliation-coral-shores-current-pointer-file-proof-2026-10-01.json',
  official_domain: 'https://coralshoresbehavioral.com/',
  official_facility_name: 'CORAL SHORES BEHAVIORAL HEALTH',
  official_facility_address: '5995 SE COMMUNITY DRIVE, STUART, FL 34997',
  pointer_url: 'https://coralshoresbehavioral.com/cms-hpt.txt',
  pointer_status: 200,
  pointer_sha256: 'C0533104576592864FA057C73236BB13D4437C4E8D38115700A7955C7DF2D37D',
  pointer_location_name: 'Coral Shores Behavioral Health',
  pointer_declared_mrf_url: 'https://uhsfilecdn.eskycity.net/bh/463794548_coral-shores_standardcharges.csv',
  pointer_entry_count: 1,
  pointer_entries_matching_facility: 1,
  facility_file_url: 'https://uhsfilecdn.eskycity.net/bh/463794548_coral-shores_standardcharges.csv',
  file_status: 200,
  file_bytes: 161764,
  file_sha256: '845C639FF18C9FAAA87E5D0C5B40AE8A37C535EE26767F0C392612B6986F5788',
  declared_hospital_name: 'Coral Shores Behavioral Health',
  declared_location_name: 'Coral Shores Behavioral Health',
  declared_address: '5995 SE COMMUNITY DRIVE, STUART, FL 34997',
  declared_license_number: '4524',
  declared_license_state: 'FL',
  declared_type_2_npis: '1366895096',
  declared_last_updated: '2026-05-19',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  pointer_transport_note: 'Pointer retrieved via web-reader MCP; curl/browser remain Cloudflare-403-blocked, so pointer_sha256 is of reader-extracted text, not wire bytes. The complete MRF was fetched directly with exact bytes and SHA-256.',
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
