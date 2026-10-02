const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T19:57:31.742Z';
const proofFile = 'reconciliation-gulfport-behavioral-pointer-mrf-identity-proof-2026-10-01.json';

const rows = {
  '254011': {
    official_domain: 'https://gulfportbehavioral.com/',
    pointer_url: 'https://gulfportbehavioral.com/cms-hpt.txt',
    pointer_sha256: 'b6e016db7ee6c31bab58d3be069f85ce0041bac58c5a1df5427774a5ea7b924b',
    pointer_location_name: 'Gulfport Behavioral',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/822306092_gulfport_standardcharges.csv',
    file_sha256: '7e092e13b32d98745f1f351089809565be96184e76e8ad8ecc43c410003ad06b',
    file_bytes: 197552,
    declared_name: 'Gulfport',
    declared_address: '11150 HIGHWAY 49 NORTH, GULFPORT, MS 39503',
    declared_type_2_npis: '1750891792',
    license_state: 'MS',
    last_updated: '2026-05-12'
  }
};

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

for (const [ccn, r] of Object.entries(rows)) {
  const record = {
    ccn,
    observed_at: observedAt,
    proof_file: proofFile,
    official_domain: r.official_domain,
    pointer_url: r.pointer_url,
    pointer_status: 200,
    pointer_sha256: r.pointer_sha256,
    pointer_entry_count: r.pointer_entry_count,
    pointer_entries_matching_facility: r.pointer_entries_matching_facility,
    pointer_location_name: r.pointer_location_name,
    pointer_declared_mrf_url: r.mrf_url,
    facility_file_url: r.mrf_url,
    file_status: 200,
    file_sample_bytes: r.file_bytes,
    file_sample_sha256: r.file_sha256,
    declared_hospital_name: r.declared_name,
    declared_location_name: r.declared_name,
    declared_address: r.declared_address,
    declared_type_2_npis: r.declared_type_2_npis,
    declared_license_state: r.license_state,
    declared_last_updated: r.last_updated,
    cms_template_version: '3.0.0',
    attestation: true,
    file_kind: 'csv',
    manual_identity: 'corroborated',
    manual_identity_gate: 'unique-pointer-entry-cms-address-state-nppes-npi-address-v3-attestation-agree',
    manual_disposition: 'verified-current-mrf',
    disposition: 'verified-current-mrf',
    next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hash is of reader-extracted text; pointer wire bytes remain unestablished. File hash is of the complete 197,552-byte response.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows) }, null, 2));
