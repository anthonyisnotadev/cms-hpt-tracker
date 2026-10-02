const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T14:18:31.489Z';
const proofFile = 'reconciliation-ummass-220001-pointer-enumeration-proof-2026-10-01.json';
const mrfUrl = 'https://d1477x5i4cdpk9.cloudfront.net/042103555_umass-memorial-healthalliance-clinton-hospital-inc._standardcharges.csv';

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const record = {
  ccn: '220001',
  observed_at: observedAt,
  proof_file: proofFile,
  official_domain: 'https://www.ummhealth.org/',
  pointer_url: 'https://ummhealth.org/cms-hpt.txt',
  pointer_status: 200,
  pointer_sha256: 'ad770211472c8a3539a185297667ad2f18ebef059f22863f7721336360914d8f',
  pointer_entry_count: 9,
  pointer_entries_matching_facility: 2,
  pointer_location_name: 'HealthAlliance-Clinton, Leominster Campus; HealthAlliance-Clinton, Clinton Campus',
  pointer_declared_mrf_url: mrfUrl,
  facility_file_url: mrfUrl,
  file_status: 206,
  file_sample_bytes: 262144,
  file_sample_sha256: '12a0bf6ea97dfe22de4cefc41a47611508c917f63cdd3731159afa478baf9a0e',
  declared_hospital_name: 'HealthAlliance - Clinton Hospital',
  declared_location_name: 'HealthAlliance - Clinton, Leominster Campus|HealthAlliance Clinton, Clinton Campus',
  declared_address: '60 Hospital Rd. Leominster, MA 01453|201 Highland St Clinton, MA 01510',
  declared_license_number: 'VWPE',
  declared_license_state: 'MA',
  declared_last_updated: '2026-03-26',
  cms_template_version: '3.0.0',
  attestation: true,
  file_kind: 'csv',
  manual_identity: 'corroborated',
  manual_identity_gate: 'root-pointer-full-enumeration-multi-campus-name-address-state-v3-attestation-agree-no-sibling',
  manual_disposition: 'verified-current-mrf',
  disposition: 'verified-current-mrf',
  next_action: 'Retain the HealthAlliance-Clinton pointer entries and facility file chain; recheck on the next publisher pointer or file change. Full-file hash remains unestablished (bounded header sample only).'
};

manual.records = manual.records.filter((x) => x.ccn !== '220001');
manual.records.push(record);
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: ['220001'], count: 1 }, null, 2));
