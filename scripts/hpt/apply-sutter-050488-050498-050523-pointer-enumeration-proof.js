const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T13:24:17.239Z';
const pointerSha = '76cf5ee42d726154cfadf3b5d2fdd6605eea5599b8751fc24707dba424a6b2ca';
const rows = {
  '050488': {
    pointer_location_name: 'EDEN MEDICAL CENTER',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/940562680-1063812907_eden-medical-center_standardcharges.csv',
    sample_sha256: '6d24646c46b9e0f64608561431c6e0cd522707d0085efd88d6747638a064d975',
    declared_hospital_name: 'Eden Medical Center',
    declared_address: '20103 Lake Chabot Road, Castro Valley, CA 94546',
    declared_type_2_npis: '1063812907|1467808659|1821351016',
    declared_license_number: '140000030',
    proof_file: 'reconciliation-sutter-050488-pointer-entry-enumeration-proof-2026-10-01.json'
  },
  '050498': {
    pointer_location_name: 'SUTTER AUBURN FAITH HOSPITAL',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/941156621-1194774299_sutter-auburn-faith-hospital_standardcharges.csv',
    sample_sha256: 'f406a5c7bf5498ba83dc1adcbc2cb75eaec0192217d1c64ba7cbe15fbad0d30a',
    declared_hospital_name: 'Sutter Auburn Faith Hospital',
    declared_address: '11815 Education Street, Auburn, CA 95603',
    declared_type_2_npis: '1194774299',
    declared_license_number: '30000012',
    proof_file: 'reconciliation-sutter-050498-pointer-entry-enumeration-proof-2026-10-01.json'
  },
  '050523': {
    pointer_location_name: 'SUTTER DELTA MEDICAL CENTER',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/940562680-1467808659_sutter-delta-medical-center_standardcharges.csv',
    sample_sha256: '62da323f04a284a49abe7d6b891dfb73775adbcf6b3f6f7a4f219d3870f40931',
    declared_hospital_name: 'Sutter Delta Medical Center',
    declared_address: '3901 Lone Tree Way, Antioch, CA 94509',
    declared_type_2_npis: '1811129752|1124135132',
    declared_license_number: '140000258',
    proof_file: 'reconciliation-sutter-050523-pointer-entry-enumeration-proof-2026-10-01.json'
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
