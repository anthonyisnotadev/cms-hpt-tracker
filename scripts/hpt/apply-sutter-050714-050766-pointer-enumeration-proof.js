const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T13:37:35.407Z';
const pointerSha = '76cf5ee42d726154cfadf3b5d2fdd6605eea5599b8751fc24707dba424a6b2ca';
const rows = {
  '050714': {
    pointer_location_name: 'SUTTER MATERNITY & SURGERY CENTER OF SANTA CRUZ',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/940562680-1689035628_sutter-maternity-surgery-center-of-santa-cruz_standardcharges.csv',
    sample_sha256: '08bcb9867e9b7e7e789240ba5e561454ba35539ff8c9fe151fd6db3a7bac3728',
    declared_hospital_name: 'Sutter Maternity & Surgery Center of Santa Cruz',
    declared_address: '2900 Chanticleer Avenue, Santa Cruz, CA 95065',
    declared_type_2_npis: '1689035628|1972749893',
    declared_license_number: '70000399',
    proof_file: 'reconciliation-sutter-050714-pointer-entry-enumeration-proof-2026-10-01.json'
  },
  '050766': {
    pointer_location_name: 'SUTTER NORTH VALLEY SURGICAL HOSPITAL',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/352182617-1336333954_sutter-north-valley-surgical-hospital_standardcharges.csv',
    sample_sha256: '2e014cb79c0eb8d105fb1676f4b0edfe1ea4c5900b2692f0c80aa77dbad7a5cd',
    declared_hospital_name: 'Sutter Surgical Hospital - North Valley',
    declared_address: '455 Plumas Blvd, Yuba City, CA 95991',
    declared_type_2_npis: '1336333954',
    declared_license_number: '550000989',
    proof_file: 'reconciliation-sutter-050766-pointer-entry-enumeration-proof-2026-10-01.json'
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
    file_status: 200,
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
