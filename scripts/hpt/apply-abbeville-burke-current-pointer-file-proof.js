'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T18:12:21.007Z';

const rows = {
  '190034': {
    proof_file: 'reconciliation-abbeville-190034-current-pointer-file-proof-2026-10-01.json',
    official_domain: 'https://abbevillegeneral.com/',
    pointer_url: 'https://abbevillegeneral.com/cms-hpt.txt',
    pointer_status: 200,
    pointer_sha256: '3771f7a6a14003b06e03d994eff28d055dc41cbdf6925479aa23d697db31605f',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    pointer_location_name: 'Abbeville General Hospital',
    pointer_source_page_url: 'https://abbevillegeneral.com/patients-visitors/for-patients/charges-billing-and-insurance/',
    mrf_url: 'https://www.abbevillegeneral.com/wp-content/uploads/720574846_abbeville-general-hospital_standardcharges.csv',
    file_status: 200,
    full_file_bytes: 99946453,
    full_file_sha256: 'bdb189cdd7bfe0c459e543d36dc5027e66f062ef0cf1b396e45facac468c5d3b',
    declared_hospital_name: 'Abbeville General Hospital',
    declared_address: '118 North Hospital Drive, Abbeville, LA 70510',
    declared_license_state: 'LA',
    declared_license_number: '160',
    declared_type_2_npis: '1255300414',
    declared_last_updated: '2026-02-09',
    cms_template_version: '3.0.0',
    attester_name: 'Kelli Smith'
  },
  '110113': {
    proof_file: 'reconciliation-burke-110113-current-pointer-file-proof-2026-10-01.json',
    official_domain: 'https://burkehealth.com/',
    pointer_url: 'https://burkehealth.com/cms-hpt.txt',
    pointer_status: 200,
    pointer_sha256: 'd871c58af0f5890c93e5cb97b308fcff05ee636fad8346e4514e86d74ddc6904',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    pointer_location_name: 'Burke Health',
    pointer_source_page_url: 'https://burkehealth.slicedhealth.io/home',
    mrf_url: 'https://burkehealth.slicedhealth.io/pricer/85-3939331-1730761065_BurkeHealth_standardcharges.CSV',
    file_status: 200,
    full_file_bytes: 12041907,
    full_file_sha256: '2945482acda49232d9d9d856cd77256511e4bb045664cc69bada98f25622136e',
    declared_hospital_name: 'Burke Health',
    declared_address: '351 S Liberty St, Waynesboro, GA 30830',
    declared_license_state: 'GA',
    declared_license_number: '017680',
    declared_type_2_npis: '1730761065',
    declared_last_updated: '2026-03-24',
    cms_template_version: '3.0.0',
    attester_name: 'Al Allred'
  }
};

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

for (const [ccn, r] of Object.entries(rows)) {
  const record = {
    ccn,
    observed_at: observedAt,
    proof_file: r.proof_file,
    official_domain: r.official_domain,
    pointer_url: r.pointer_url,
    pointer_status: r.pointer_status,
    pointer_sha256: r.pointer_sha256,
    pointer_entry_count: r.pointer_entry_count,
    pointer_entries_matching_facility: r.pointer_entries_matching_facility,
    pointer_location_name: r.pointer_location_name,
    pointer_source_page_url: r.pointer_source_page_url,
    pointer_declared_mrf_url: r.mrf_url,
    facility_file_url: r.mrf_url,
    file_status: r.file_status,
    full_file_bytes: r.full_file_bytes,
    full_file_sha256: r.full_file_sha256,
    declared_hospital_name: r.declared_hospital_name,
    declared_location_name: r.declared_hospital_name,
    declared_address: r.declared_address,
    declared_license_state: r.declared_license_state,
    declared_license_number: r.declared_license_number,
    declared_type_2_npis: r.declared_type_2_npis,
    declared_last_updated: r.declared_last_updated,
    cms_template_version: r.cms_template_version,
    attestation: true,
    attester_name: r.attester_name,
    file_kind: 'csv',
    manual_identity: 'corroborated',
    manual_identity_gate: 'unique-pointer-entry-ccn-npi-name-address-state-v3-attestation-agree-no-sibling',
    manual_disposition: 'verified-current-mrf',
    disposition: 'verified-current-mrf',
    next_action: 'Retain the unique pointer entry and complete facility file chain (full-file SHA-256 established); recheck on the next publisher pointer or file change.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows) }, null, 2));
