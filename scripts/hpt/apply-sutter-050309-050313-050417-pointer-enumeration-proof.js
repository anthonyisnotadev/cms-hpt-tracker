const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T12:58:45.653Z';
const pointerSha = '76cf5ee42d726154cfadf3b5d2fdd6605eea5599b8751fc24707dba424a6b2ca';
const rows = {
  '050309': {
    pointer_location_name: 'SUTTER ROSEVILLE MEDICAL CENTER',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/941156621-1356390264_sutter-roseville-medical-center_standardcharges.csv',
    sample_sha256: 'bfcbf921f986f77f12f18ed967171a4b21b777bfe9de0f5262c5dabd412a20ac',
    declared_hospital_name: 'Sutter Roseville Medical Center',
    declared_address: 'One Medical Plaza, Roseville, CA 95661',
    declared_type_2_npis: '1093961682|1356390264',
    declared_license_number: '30000083',
    proof_file: 'reconciliation-sutter-050309-pointer-entry-enumeration-proof-2026-10-01.json'
  },
  '050313': {
    pointer_location_name: 'SUTTER TRACY COMMUNITY HOSPITAL',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/941156621-1821442864_sutter-tracy-community-hospital_standardcharges.csv',
    sample_sha256: 'ec18688b3f79e40fa518430e6e9f491f7ab0572a101863ce930f7990ee85900d',
    declared_hospital_name: 'Sutter Tracy Community Hospital',
    declared_address: '1420 North Tracy Blvd, Tracy, CA 95376',
    declared_type_2_npis: '1770726861|1821442864',
    declared_license_number: '30000105',
    proof_file: 'reconciliation-sutter-050313-pointer-entry-enumeration-proof-2026-10-01.json'
  },
  '050417': {
    pointer_location_name: 'SUTTER COAST HOSPITAL',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/942988520-1457367062_sutter-coast-hospital_standardcharges.csv',
    sample_sha256: '769737dcd0114f6a75417a2e3620441f041430b845024a16d028caed76f2e5c9',
    declared_hospital_name: 'Sutter Coast Hospital',
    declared_address: '800 E Washington Blvd, Crescent City, CA 95531',
    declared_type_2_npis: '1457367062|1720463391',
    declared_license_number: '110000067',
    proof_file: 'reconciliation-sutter-050417-pointer-entry-enumeration-proof-2026-10-01.json'
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
