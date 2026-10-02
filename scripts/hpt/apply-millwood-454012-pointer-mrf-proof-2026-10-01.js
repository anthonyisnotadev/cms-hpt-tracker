const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T20:32:19.929Z';
const proofFile = 'reconciliation-millwood-pointer-mrf-retrieval-proof-2026-10-01.json';

const rows = {
  '454012': {
    official_domain: 'https://millwoodhospital.com/',
    pointer_url: 'https://millwoodhospital.com/cms-hpt.txt',
    pointer_sha256: '0ae13486ba841051e2c7a12e801db8e673f530e6adaf25dc463a5aea51f893b3',
    pointer_location_name: 'Millwood Hospital',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/201021264_millwood_standardcharges.csv',
    file_sha256: '5a176020fb97742c3e6e5391528cd67dda9068ece12e84c8fecb92918a9e17e4',
    file_bytes: 262144,
    declared_name: 'Millwood Hospital',
    declared_address: '1011 N COOPER ST, ARLINGTON, TX 76011',
    declared_type_2_npis: '1023015120',
    license_state: 'TX',
    last_updated: '2026-08-31'
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
    manual_identity_gate: 'unique-pointer-entry-name-address-state-v3-attestation-agree',
    manual_disposition: 'verified-current-mrf',
    disposition: 'verified-current-mrf',
    next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hash is of reader-extracted text; pointer wire bytes remain unestablished. File sample hash is of a bounded 262,144-byte prefix of the 658,816-byte response; the full-file hash remains unestablished.',
    current_official_domain: r.official_domain,
    observation: 'Access route correction: prior browser automation hit an anti-bot interstitial/403 on millwoodhospital.com; this session the web-reader route succeeded and recovered the CMS pointer and the UHS CDN standard-charges CSV for CCN 454012 (Millwood Hospital, 1011 N Cooper St, Arlington, TX 76011).'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows) }, null, 2));
