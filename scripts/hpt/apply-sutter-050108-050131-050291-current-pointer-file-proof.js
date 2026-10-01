const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T04:18:17.472Z';
const pointerSha = '76cf5ee42d726154cfadf3b5d2fdd6605eea5599b8751fc24707dba424a6b2ca';
const rows = {
  '050108': {
    roster_name: 'SUTTER MEDICAL CENTER, SACRAMENTO',
    roster_address: '2825 CAPITOL AVENUE, SACRAMENTO, CA 95816',
    pointer_location_name: 'SUTTER MEDICAL CENTER SACRAMENTO',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/941156621-1811946734_sutter-medical-center-sacramento_standardcharges.csv',
    total_bytes: 16401921,
    file_sha256: 'abdfa61e67fd9ebdc85df3a0c73cf3b4d12a0d8f0502ad73472b9ec180c7db94',
    declared_hospital_name: 'Sutter Medical Center, Sacramento',
    declared_address: '2825 Capitol Avenue, Sacramento, CA 95816',
    declared_license_number: '30000102',
    declared_type2_npis: '1811946734',
    proof_file: 'reconciliation-sutter-050108-current-pointer-file-proof-2026-10-01.json'
  },
  '050131': {
    roster_name: 'NOVATO COMMUNITY HOSPITAL',
    roster_address: '180 ROWLAND WAY, NOVATO, CA 94945',
    pointer_location_name: 'NOVATO COMMUNITY HOSPITAL',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/940562680-1104059153_novato-community-hospital_standardcharges.csv',
    total_bytes: 9845278,
    file_sha256: 'e18fcd91cd32eb46f215f44557e348f18d6b3cd2aae534b47c2052c5f580456c',
    declared_hospital_name: 'Novato Community Hospital',
    declared_address: '180 Rowland Way, Novato, CA 94945',
    declared_license_number: '110000375',
    declared_type2_npis: '1104059153',
    proof_file: 'reconciliation-sutter-050131-current-pointer-file-proof-2026-10-01.json'
  },
  '050291': {
    roster_name: 'SUTTER SANTA ROSA REGIONAL HOSPITAL',
    roster_address: '30 MARK WEST SPRINGS ROAD, SANTA ROSA, CA 95403',
    pointer_location_name: 'SUTTER SANTA ROSA REGIONAL HOSPITAL',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/940562680-1740413798_sutter-santa-rosa-regional-hospital_standardcharges.csv',
    total_bytes: 14631528,
    file_sha256: 'ebc3dc239ec6ab9fede0153f241f21a67eb7016fab4da64a8b7bd6eaa208bf7a',
    declared_hospital_name: 'Sutter Santa Rosa Regional Hospital',
    declared_address: '30 Mark West Springs Road, Santa Rosa, CA 95403',
    declared_license_number: '110000005',
    declared_type2_npis: '1740413798',
    proof_file: 'reconciliation-sutter-050291-current-pointer-file-proof-2026-10-01.json'
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
