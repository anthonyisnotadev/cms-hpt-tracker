const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T19:40:43.273Z';
const proofFile = 'reconciliation-fort-duncan-pointer-mrf-retrieval-proof-2026-10-01.json';

const rows = {
  '450092': {
    official_domain: 'https://fortduncanmedicalcenter.com/',
    pointer_url: 'https://fortduncanmedicalcenter.com/cms-hpt.txt',
    pointer_sha256: '9a678aceea73755e840cc6888863ff01cc4b3d796395fbc96c3a729fa1b3ee1c',
    pointer_location_name: 'Fort Duncan Regional Medical Center',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    mrf_url: 'https://uhsfilecdn.eskycity.net/ac/233044530_fort-duncan-regional-medical-center_standardcharges.csv',
    file_sha256: '8a92221e021bcad0e38cc489391997469b64cd25c344a51e216ee76ad7c82a89',
    file_bytes: 60594287,
    declared_name: 'Fort Duncan Medical Center LP',
    declared_address: '3333 N. Foster Maldonado Boulevard, Eagle Pass, TX 78852',
    declared_type_2_npis: '1770579591|1083799514',
    license_state: 'TX',
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
    declared_location_name: r.pointer_location_name,
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
    next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hash is of reader-extracted text (direct fetch returns Cloudflare 403 to automation); pointer wire bytes remain unestablished. File hash is of the complete 60,594,287-byte response.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows) }, null, 2));
