const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T19:46:59.286Z';
const proofFile = 'reconciliation-genesis-behavioral-pointer-mrf-retrieval-proof-2026-10-01.json';

const rows = {
  '194089': {
    official_domain: 'https://genesisbh.com/',
    pointer_url: 'https://genesisbh.com/cms-hpt.txt',
    pointer_sha256: 'dc3a3ca4ca16d718a5442f6e649669fdb62f55b6b57b62af1d84e0b944d9f221',
    pointer_location_name: 'Genesis Behavioral Hospital',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    mrf_url: 'https://www.genesisbh.com/_files/ugd/b56b0c_36f806c57ce2413bb5e9e85640fc2954.csv?dn=421650702_genesis-behavioral-hospital_standardcharges.csv',
    file_sha256: '32bb52e72f9a1ca1c4af7f6889e137f9f540f88d951a6516f3b19967aa0f5588',
    file_bytes: 19386,
    declared_name: 'Genesis Behavioral Hospital Inc',
    declared_address: '606 Latiolais Dr, Breaux Bridge, LA 70517',
    declared_type_2_npis: "1023119989'",
    license_state: 'LA',
    last_updated: '2026-09-17'
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
    declared_location_name: 'Genesis Behavioral Hospital - Breaux Bridge',
    declared_address: r.declared_address,
    declared_type_2_npis: r.declared_type_2_npis,
    declared_license_state: r.license_state,
    declared_last_updated: r.last_updated,
    cms_template_version: '3.0.0',
    attestation: true,
    file_kind: 'csv',
    manual_identity: 'corroborated',
    manual_identity_gate: 'unique-pointer-entry-name-address-state-v3-attestation-agree',
    manual_disposition: 'verified-current-mrf',
    disposition: 'verified-current-mrf',
    next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hash is of reader-extracted text; pointer wire bytes remain unestablished. File hash is of the complete 19,386-byte response. Declared type_2_npi field carries a trailing apostrophe (1023119989) - minor data quirk noted in proof.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows) }, null, 2));
