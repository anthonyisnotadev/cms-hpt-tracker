'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T20:25:31.000Z';

const rows = {
  '191325': {
    proof_file: 'reconciliation-lady-of-sea-191325-current-pointer-file-proof-2026-10-01.json',
    official_domain: 'https://www.losgh.org/',
    pointer_url: 'https://www.losgh.org/cms-hpt.txt',
    pointer_status: 200,
    pointer_sha256: 'db1fe575ad138905ad5e14e637e4fd70c9061206d9b2daa34e380c9c3426f3f6',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    pointer_location_name: 'Lady of the Sea General Hospital',
    pointer_source_page_url: 'https://www.losgh.org/price-transparency.php',
    mrf_url: 'https://www.losgh.org/financial%20policies/726012041_lafourche-parish-hospital-service-district-no-1_standardcharges.csv',
    file_status: 200,
    full_file_bytes: 14201496,
    full_file_sha256: 'e5f6e290df8a213604c9e263e619a714fd0bdadfb1936be850f912dadc9dd65f',
    declared_hospital_name: 'Lafourche Parish Hospital Service District No. 1',
    declared_location_name: 'Lady of the Sea',
    declared_address: '200 W 134th Place, Cut Off, LA 70345',
    declared_license_state: 'LA',
    declared_license_number: '2203786888',
    declared_type_2_npis: '1407883341',
    declared_last_updated: '2026-09-15',
    cms_template_version: '3.0.0',
    attester_name: 'Lloyd Guidry'
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
    declared_location_name: r.declared_location_name,
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
