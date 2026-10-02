'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T17:40:36.024Z';
const mrfUrl = 'https://uhsfilecdn.eskycity.net/bh/270608044_arrowhead_standardcharges.csv';

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn: '364036',
  observed_at: observedAt,
  proof_file: 'reconciliation-arrowhead-364036-pointer-mrf-webreader-proof-2026-10-01.json',
  official_domain: 'https://arrowheadbehavioral.com/',
  pointer_url: 'https://arrowheadbehavioral.com/cms-hpt.txt',
  pointer_status: 200,
  pointer_sha256: 'e6096d9010f521a6684011c1ef2a72065c60b480ea773619fa5a42ed00a1b759',
  pointer_entry_count: 1,
  pointer_entries_matching_facility: 1,
  pointer_location_name: 'Arrowhead Behavioral Health',
  pointer_declared_mrf_url: mrfUrl,
  facility_file_url: mrfUrl,
  file_status: 200,
  file_sample_bytes: 65118,
  file_sample_sha256: '4ea271ce3681f71ccf7b818c14830400335892ee9952ad30fc9c2368520017f5',
  declared_hospital_name: 'Arrowhead Behavioral Health',
  declared_location_name: 'Arrowhead Behavioral Health',
  declared_address: '1725 Timberline Road, Maumee, OH 43537',
  declared_type_2_npis: '1336370196',
  declared_license_state: 'OH',
  declared_last_updated: '2026-06-11',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'unique-pointer-entry-name-address-state-v3-attestation-agree',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hash is of reader-extracted text; exact pointer wire bytes remain unestablished.'
};

manual.records = manual.records.filter(x => x.ccn !== '364036');
manual.records.push(record);
manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: '364036' }, null, 2));
