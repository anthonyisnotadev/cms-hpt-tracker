const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T03:47:57.704Z';
const pricingPageSha = 'eb2334c20ab9232674d038fbdc2b8191f8450db287c756cb3cc55d19f6f4f71b';
const pointerSha = '76cf5ee42d726154cfadf3b5d2fdd6605eea5599b8751fc24707dba424a6b2ca';
const rows = {
  '050014': {
    roster_name: 'SUTTER AMADOR HOSPITAL',
    roster_address: '200 MISSION BLVD, JACKSON, CA',
    pointer_location_name: 'SUTTER AMADOR HOSPITAL',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/941156621-1447494323_sutter-amador-hospital_standardcharges.csv',
    total_bytes: 7330878,
    file_sha256: '827d76dbe7f90f6214926620269d0473f7b9c0f2a36cca2d2faab958df6a47ce',
    declared_hospital_name: 'Sutter Amador Hospital',
    declared_address: '200 Mission Blvd, Jackson, CA 95642',
    declared_license_number: '30000008',
    declared_type2_npis: '1447494323',
    page_label: 'Sutter Amador Hospital',
    proof_file: 'reconciliation-sutter-050014-current-pointer-file-proof-2026-10-01.json'
  },
  '050047': {
    roster_name: 'CALIFORNIA PACIFIC MEDICAL CENTER- VAN NESS CAMPUS',
    roster_address: '1101 VAN NESS AVENUE, SAN FRANCISCO, CA',
    pointer_location_name: 'CALIFORNIA PACIFIC MEDICAL CENTER VAN NESS CAMPUS',
    mrf_url: 'https://edge.sitecorecloud.io/sutterhealt962c-sutterhealt8fce-production57cc-4860/media/Project/SutterHealth/SutterHealth/Files/billing-insurance/costs-and-charges/940562680-1740348929_california-pacific-medical-center-van-ness-campus_standardcharges.csv',
    total_bytes: 16860354,
    file_sha256: 'd57c91a91d1b45e6de683ec31204b8bd4fd0d652d1fe448fa23202a31f757a14',
    declared_hospital_name: 'California Pacific Medical Center- Van Ness Campus',
    declared_address: '1101 Van Ness Avenue, San Francisco, CA 94109',
    declared_license_number: '220000197',
    declared_type2_npis: '1104984392|1689732885|1740348929|1831257013|1871731810|1902964109',
    page_label: 'CPMC – Van Ness Campus and Pacific Heights Outpatient Center',
    proof_file: 'reconciliation-sutter-050047-current-pointer-file-proof-2026-10-01.json'
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
    official_pricing_page: 'https://www.sutterhealth.org/billing-insurance/costs-and-charges/cost-transparency',
    official_pricing_page_status: 200,
    official_pricing_page_sha256: pricingPageSha,
    official_facility_name: r.roster_name,
    official_facility_address: r.roster_address,
    pointer_url: 'https://www.sutterhealth.org/cms-hpt.txt',
    pointer_status: 200,
    pointer_sha256: pointerSha,
    pointer_location_name: r.pointer_location_name,
    pointer_declared_mrf_url: r.mrf_url,
    facility_file_url: r.mrf_url,
    file_status: 206,
    file_bytes: 65536,
    file_sha256: r.file_sha256,
    declared_hospital_name: r.declared_hospital_name,
    declared_location_name: r.declared_hospital_name,
    declared_address: r.declared_address,
    declared_license_number: r.declared_license_number,
    declared_license_state: 'CA',
    declared_npi: '',
    declared_last_updated: '2026-04-01',
    cms_template_version: '3.0.0',
    attestation: true,
    file_kind: 'csv',
    manual_identity: 'corroborated',
    manual_identity_gate: 'official-file-header-name-address-state-version-attestation-agree',
    manual_disposition: 'verified-current-mrf',
    disposition: 'verified-current-mrf',
    latest_pointer_recheck: {
      observed_at: observedAt,
      pointer_url: 'https://www.sutterhealth.org/cms-hpt.txt',
      pointer_http_status: 200,
      pointer_bytes: 25914,
      pointer_sha256: pointerSha,
      pointer_location_name: r.pointer_location_name,
      pointer_declared_mrf_url: r.mrf_url,
      exact_pointer_mrf_status: 206,
      declared_hospital_name: r.declared_hospital_name,
      declared_location_name: r.declared_hospital_name,
      declared_address: r.declared_address,
      declared_license_state: 'CA',
      declared_last_updated: '2026-04-01',
      cms_template_version: '3.0.0',
      declared_npi: '',
      declared_attestation: true,
      manual_identity: 'corroborated',
      manual_identity_gate: 'exact-pointer-ccn-file-name-address-state-v3-attestation-agree',
      manual_disposition: 'verified-current-mrf'
    },
    next_action: 'Retain the exact pointer/page/file chain and recheck on the next publisher pointer or file change; keep separately named Sutter campuses and CCNs distinct.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows), count: Object.keys(rows).length }, null, 2));
