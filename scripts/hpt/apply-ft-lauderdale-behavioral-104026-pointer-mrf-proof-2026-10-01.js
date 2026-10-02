const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T19:44:13.985Z';
const proofFile = 'reconciliation-ft-lauderdale-behavioral-pointer-mrf-retrieval-proof-2026-10-01.json';

const rows = {
  '104026': {
    official_domain: 'https://ftlauderdalebehavioral.com/',
    pointer_url: 'https://ftlauderdalebehavioral.com/cms-hpt.txt',
    pointer_sha256: '755bd08004cc0f78388d12b0992baab3b662666454e795ebe0e2fd71fa2e0dd1',
    pointer_location_name: 'Fort Lauderdale Behavioral Health Center',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/201021229_ft-lauderdale_standardcharges.csv',
    file_sha256: 'b89df32652bf6ea8cc177d557bbbd58aac641059dd8f8fc93c8c66dff82d280b',
    file_bytes: 160650,
    declared_name: 'Fort Lauderdale Behavioral Health Center',
    declared_address: '5757 N DIXIE HWY, OAKLAND PARK, FL 33334',
    declared_type_2_npis: '1649224320',
    license_state: 'FL',
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
    manual_identity_gate: 'unique-pointer-entry-name-address-state-v3-attestation-agree',
    manual_disposition: 'verified-current-mrf',
    disposition: 'verified-current-mrf',
    next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hash is of reader-extracted text; pointer wire bytes remain unestablished. File hash is of the complete 160,650-byte response.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows) }, null, 2));
