const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T20:07:28.872Z';
const ccn = '371321';

const record = {
  ccn,
  observed_at: observedAt,
  proof_file: 'reconciliation-holdenville-371321-page-file-proof-2026-10-01.json',
  official_domain: 'https://holdenvillehospital.com/',
  official_facility_name: 'HOLDENVILLE GENERAL HOSPITAL',
  official_facility_address: '100 McDougal Dr, Holdenville, OK 74848',
  pointer_url: 'https://holdenvillehospital.com/price-transparency',
  pointer_status: 200,
  root_pointer_url: 'https://holdenvillehospital.com/cms-hpt.txt',
  root_pointer_status: 404,
  pointer_location_name: 'Holdenville General Hospital, 100 McDougal Drive, Holdenville, OK 74848',
  pointer_declared_mrf_url: 'https://s3.amazonaws.com/ycubaa-production-marlin-1-charge-management-public/facilities/f25a1e6a-ed78-4641-a1c6-fcebfa80bf1b/731538589_HOLDENVILLE-GENERAL-HOSPITAL_standardcharges.zip',
  facility_file_url: 'https://s3.amazonaws.com/ycubaa-production-marlin-1-charge-management-public/facilities/f25a1e6a-ed78-4641-a1c6-fcebfa80bf1b/731538589_HOLDENVILLE-GENERAL-HOSPITAL_standardcharges.zip',
  file_status: 200,
  file_bytes: 43400388,
  file_sha256: '3df8a0003211f792eb0ed87f5ba68ef9a5519d950718519e9a66779959ca332d',
  declared_hospital_name: 'HOLDENVILLE GENERAL HOSPITAL',
  declared_location_name: 'HOLDENVILLE GENERAL HOSPITAL',
  declared_address: '100 MCDOUGAL DRIVE,HOLDENVILLE,OK,74848-0000',
  declared_license_number: '2195',
  declared_license_state: 'OK',
  declared_last_updated: '2026-04-07',
  cms_template_version: '3.0.0',
  declared_type_2_npis: '1265851455',
  attestation: true,
  file_kind: 'zip-csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'official-page-linked-file-name-address-state-v3-attestation-agree',
  disposition: 'verified-current-mrf',
  interpretation: 'The official Holdenville General Hospital pricing page (HTTP 200) links the MEDHOST YourCareEverywhere estimator, which names the facility at 100 McDougal Drive, Holdenville, OK 74848 and offers a complete 43,400,388-byte ZIP holding a 641,168,567-byte CMS 3.0.0 CSV with declared name, Holdenville OK address, license 2195, Type 2 NPI 1265851455, 2026-04-07 date and attestation TRUE. Root cms-hpt.txt is 404; linkage is page-based.',
  next_action: 'Retain the page-linked MRF and recheck on the next pricing-page or estimator file change; root cms-hpt.txt remains separately absent (404).'
};

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
manual.records = manual.records.filter(x => x.ccn !== ccn);
manual.records.push(record);
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ccn, disposition: record.disposition }, null, 2));
