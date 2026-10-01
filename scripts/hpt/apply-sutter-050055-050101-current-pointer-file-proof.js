const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T04:11:55.635Z';
const pointerSha = '76cf5ee42d726154cfadf3b5d2fdd6605eea5599b8751fc24707dba424a6b2ca';
const rows = {
  '050055': {
    roster_name: 'CALIFORNIA PACIFIC MEDICAL CENTER - MISSION BERNAL',
    roster_address: '3555 CESAR CHAVEZ, SAN FRANCISCO, CA 94110',
    pointer_location_name: 'CALIFORNIA PACIFIC MEDICAL CENTER MISSION BERNAL CAMPUS',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/940562680-1730238007_california-pacific-medical-center-mission-bernal-campus_standardcharges.csv',
    total_bytes: 16311846,
    file_sha256: '83b78871d4329f0a5a814bca890775e83b5c923d8107d5c1a4f93b4c4290d6b5',
    declared_hospital_name: 'California Pacific Medical Center - Mission Bernal',
    declared_address: '3555 Cesar Chavez, San Francisco, CA 94110',
    declared_license_number: '220000070',
    declared_type2_npis: '1134247281|1730238007|1881712933',
    proof_file: 'reconciliation-sutter-050055-current-pointer-file-proof-2026-10-01.json'
  },
  '050101': {
    roster_name: 'SUTTER SOLANO MEDICAL CENTER',
    roster_address: '300 HOSPITAL DR, VALLEJO, CA 94589',
    pointer_location_name: 'SUTTER SOLANO MEDICAL CENTER',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/941156621-1366686248_sutter-solano-medical-center_standardcharges.csv',
    total_bytes: 11201093,
    file_sha256: '08bd9648577a9c51bf138aa117ac74036fff740b6b495655684d36e580df9f50',
    declared_hospital_name: 'Sutter Solano Medical Center',
    declared_address: '300 Hospital Dr, Vallejo, CA 94589',
    declared_license_number: '110000082',
    declared_type2_npis: '1366686248',
    proof_file: 'reconciliation-sutter-050101-current-pointer-file-proof-2026-10-01.json'
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
    official_facility_name: r.roster_name,
    official_facility_address: r.roster_address,
    pointer_url: 'https://www.sutterhealth.org/cms-hpt.txt',
    pointer_status: 200,
    pointer_sha256: pointerSha,
    pointer_location_name: r.pointer_location_name,
    pointer_declared_mrf_url: r.mrf_url,
    facility_file_url: r.mrf_url,
    file_status: 200,
    file_bytes: r.total_bytes,
    file_sha256: r.file_sha256,
    declared_hospital_name: r.declared_hospital_name,
    declared_location_name: r.declared_hospital_name,
    declared_address: r.declared_address,
    declared_license_number: r.declared_license_number,
    declared_license_state: 'CA',
    declared_last_updated: '2026-04-01',
    cms_template_version: '3.0.0',
    attestation: true,
    file_kind: 'csv',
    manual_identity: 'corroborated',
    manual_identity_gate: 'exact-pointer-ccn-file-name-address-state-v3-attestation-agree',
    manual_disposition: 'verified-current-mrf',
    disposition: 'verified-current-mrf',
    next_action: 'Retain the exact pointer/file chain and recheck on the next publisher pointer or file change; keep separately named Sutter campuses and CCNs distinct.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
