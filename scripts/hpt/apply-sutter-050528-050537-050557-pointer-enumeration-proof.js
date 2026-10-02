const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T13:30:42.316Z';
const pointerSha = '76cf5ee42d726154cfadf3b5d2fdd6605eea5599b8751fc24707dba424a6b2ca';
const rows = {
  '050528': {
    pointer_location_name: 'MEMORIAL HOSPITAL LOS BANOS',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/941156621-1366896300_memorial-hospital-los-banos_standardcharges.csv',
    sample_sha256: 'f62cf61d9fe05babe8d693f270e9756b64830b6061a6adb9e62731f25e047030',
    declared_hospital_name: 'Memorial Hospital Los Banos',
    declared_address: '520 West I St, Los Banos, CA 93635',
    declared_type_2_npis: '1033352125|1366896300',
    proof_file: 'reconciliation-sutter-050528-pointer-entry-enumeration-proof-2026-10-01.json'
  },
  '050537': {
    pointer_location_name: 'SUTTER DAVIS HOSPITAL',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/941156621-1770532608_sutter-davis-hospital_standardcharges.csv',
    sample_sha256: '8939e73700de1f3958134e1d2ca0a649d0fb073c9158a24feadbef877683bb76',
    declared_hospital_name: 'Sutter Davis Hospital',
    declared_address: '2000 Sutter Place, Davis, CA 95616',
    declared_type_2_npis: '1770532608',
    proof_file: 'reconciliation-sutter-050537-pointer-entry-enumeration-proof-2026-10-01.json'
  },
  '050557': {
    pointer_location_name: 'MEMORIAL MEDICAL CENTER',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/941156621-1699129601_memorial-medical-center_standardcharges.csv',
    sample_sha256: '62620b0226634e78f7fbe99e095746f2ca5a20704acbc9a459f3c562886e7c50',
    declared_hospital_name: 'Memorial Medical Center',
    declared_address: '1700 Coffee Rd, Modesto, CA 95355',
    declared_type_2_npis: '1629059746|1699129601',
    proof_file: 'reconciliation-sutter-050557-pointer-entry-enumeration-proof-2026-10-01.json'
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
