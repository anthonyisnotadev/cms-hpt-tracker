const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T19:48:35.267Z';
const proofFile = 'reconciliation-granite-hills-pointer-mrf-retrieval-proof-2026-10-01.json';

const rows = {
  '524043': {
    official_domain: 'https://granitehillshospital.com/',
    pointer_url: 'https://granitehillshospital.com/cms-hpt.txt',
    pointer_sha256: '6960968b00a38544c8b801ced317268ab37befe6d13a87ea2b2a3af7afe64e72',
    pointer_location_name: 'Granite Hills Hospital',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/831464210_granite-hills_standardcharges.csv',
    file_sha256: 'fbf6e484936e1f97516a842383c0d8941d00b1547d0c6ba92e5b50cdbe1b3096',
    file_bytes: 12638,
    declared_name: 'Granite Hills Hospital',
    declared_address: '1706 S 68TH STREET, WEST ALLIS, WI 53214',
    declared_type_2_npis: '1497324115',
    license_state: 'WI',
    last_updated: '2026-05-14'
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
    next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hash is of reader-extracted text; pointer wire bytes remain unestablished. File hash is of the complete 12,638-byte response.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows) }, null, 2));
