const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T13:44:58.024Z';
const pointerSha = '76cf5ee42d726154cfadf3b5d2fdd6605eea5599b8751fc24707dba424a6b2ca';
const rows = {
  '051329': {
    pointer_location_name: 'SUTTER LAKESIDE HOSPITAL',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/940562680-1952634008_sutter-lakeside-hospital_standardcharges.csv',
    sample_sha256: '551c737358b7ee6e9cad07faabffad70a201d3ac49e0763be910ef36b2b96e6f',
    declared_hospital_name: 'Sutter Lakeside Hospital',
    declared_address: '5176 Hill Road East, Lakeport, CA 95453',
    declared_type_2_npis: '1952350944',
    declared_license_number: '110000094',
    proof_file: 'reconciliation-sutter-051329-pointer-entry-enumeration-proof-2026-10-01.json'
  },
  '054096': {
    pointer_location_name: 'SUTTER CENTER FOR PSYCHIATRY',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/941156621-1952350944_sutter-center-for-psychiatry_standardcharges.csv',
    sample_sha256: 'f20e6b4c0bb22c83ca5692a089e7626c82d39e8f8907aabb41d0e8e93a1e9d34',
    declared_hospital_name: 'Sutter Center For Psychiatry',
    declared_address: '7700 Folsom Blvd, Sacramento, CA 95826',
    declared_type_2_npis: '1598098642|1952634008',
    declared_license_number: '30000347',
    proof_file: 'reconciliation-sutter-054096-pointer-entry-enumeration-proof-2026-10-01.json'
  }
};

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

for (const [ccn, r] of Object.entries(rows)) {
  const record = {
    ccn,
    observed_at: observedAt,
    proof_file: r.proof_file,
    official_domain: 'https://www.sutterhealth.org/',
    pointer_url: 'https://www.sutterhealth.org/cms-hpt.txt',
    pointer_status: 200,
    pointer_sha256: pointerSha,
    pointer_entry_count: 27,
    pointer_entries_matching_facility: 1,
    pointer_location_name: r.pointer_location_name,
    pointer_declared_mrf_url: r.mrf_url,
    facility_file_url: r.mrf_url,
    file_status: 206,
    file_sample_bytes: 262144,
    file_sample_sha256: r.sample_sha256,
    declared_hospital_name: r.declared_hospital_name,
    declared_location_name: r.declared_hospital_name,
    declared_address: r.declared_address,
    declared_type_2_npis: r.declared_type_2_npis,
    declared_license_number: r.declared_license_number,
    declared_license_state: 'CA',
    declared_last_updated: '2026-04-01',
    cms_template_version: '3.0.0',
    attestation: true,
    file_kind: 'csv',
    manual_identity: 'corroborated',
    manual_identity_gate: 'unique-pointer-entry-ccn-npi-name-address-state-v3-attestation-agree-no-sibling',
    manual_disposition: 'verified-current-mrf',
    disposition: 'verified-current-mrf',
    next_action: 'Retain the unique pointer entry and facility file chain; recheck on the next publisher pointer or file change. Full-file hash remains unestablished (bounded header sample only).'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
