const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T20:23:50.000Z';
const proofFile = 'reconciliation-michiana-pointer-mrf-retrieval-proof-2026-10-01.json';

const rows = {
  '154047': {
    official_domain: 'https://michianabehavioralhealth.com/',
    pointer_url: 'https://michianabehavioralhealth.com/cms-hpt.txt',
    pointer_sha256: '1f669106e35f4951e5a6e7136e8e21a556f99f386a8df2a745d81e59cc0d305a',
    pointer_location_name: 'Michiana Behavioral Health Center',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/200768028_michiana_standardcharges.csv',
    file_sha256: 'f14128af4639783fe83bb2ff308e5ba9987bc54ca39f6b94f81c0f8a1a9dc5ab',
    file_bytes: 72018,
    declared_name: 'Michiana Behavioral Health Center',
    declared_address: '1800 NORTH OAK DRIVE, PLYMOUTH, IN 46563',
    declared_type_2_npis: '1801822440',
    license_state: 'IN',
    last_updated: '2026-06-03'
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
    next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hash is of reader-extracted text (direct fetch is Cloudflare-403 in this client); pointer wire bytes remain unestablished. File hash is of the complete 72,018-byte response.',
    current_official_domain: r.official_domain,
    observation: 'Domain correction: recorded michianabehavioralhealthcenter.com was not corroborated by search and returned 403 to direct fetch. The official first-party site is michianabehavioralhealth.com (Michiana Behavioral Health, 1800 North Oak Drive, Plymouth, IN 46563) and carries the live CMS pointer naming CCN 154047 and the UHS CDN standard-charges CSV.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows) }, null, 2));
