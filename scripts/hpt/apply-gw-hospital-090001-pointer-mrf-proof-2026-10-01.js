const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T19:59:16.436Z';
const proofFile = 'reconciliation-gw-hospital-pointer-mrf-retrieval-proof-2026-10-01.json';

const rows = {
  '090001': {
    official_domain: 'https://www.gwhospital.com/',
    pointer_url: 'https://www.gwhospital.com/cms-hpt.txt',
    pointer_sha256: 'e7e94d86fedee6252718271424b81dea63055223bf8d608b210623eba6863fde',
    pointer_location_name: 'George Washington University Hospital',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    mrf_url: 'https://uhsfilecdn.eskycity.net/ac/232896725_george-washington-university-hospital_standardcharges.csv',
    file_sha256: '3b91591089b0fadf72905607b261ce34dc2f53bc606b60a2cb841c6bc5a66cff',
    file_bytes: 60449072,
    declared_name: 'The George Washington University Hospital',
    declared_address: '900 23rd Street, NW, Washington, DC 20037',
    declared_type_2_npis: '1487640207',
    license_state: 'DC',
    last_updated: '2026-09-01'
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
    next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hash is of reader-extracted text (first-party site has challenged direct automation before); pointer wire bytes remain unestablished. File hash is of the complete 60,449,072-byte response.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows) }, null, 2));
