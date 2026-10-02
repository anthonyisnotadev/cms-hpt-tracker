'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T23:06:23.071Z';
const proofFile = 'reconciliation-memorial-tx-three-pointer-mrf-proof-2026-10-01.json';

const rows = {
  '450235': {
    official_domain: 'https://www.gonzaleshealthcare.com/',
    pointer_url: 'https://www.gonzaleshealthcare.com/cms-hpt.txt',
    pointer_sha256: '46534ba50e78425f6d810c65621a2e7104de585a3e9ec36f8415cb80ba4e32c1',
    pointer_location_name: 'Gonzales Healthcare Systems',
    mrf_url: 'https://hospitalpricetransparencyfiles.com/gonzales-healthcare-systems/741625013_Gonzales-Healthcare-Systems_standardcharges.csv',
    file_sha256: '497a29608d16e7a805683931a721257dbc7603a1e34ae9ea7621db00278df061',
    file_bytes: 1630128,
    declared_name: 'Gonzales Healthcare Systems',
    declared_location_name: 'Gonzales Memorial Hospital',
    declared_address: '1110 Sarah DeWitt Drive, Gonzales, TX  78629',
    declared_type_2_npis: '1932108214|1508859612|1699768705|1881687994|1114711306',
    license_state: 'TX',
    last_updated: '1/7/2026'
  },
  '451358': {
    official_domain: 'https://seminolehospitaldistrict.com/',
    pointer_url: 'https://seminolehospitaldistrict.com/wp-content/uploads/2024/07/cms-hpt.txt',
    pointer_sha256: '9616d94fd2fd93c746ed8ea0d3fc0296cdea443803ff5a71eb5fb515cbe88631',
    pointer_location_name: 'Seminole Hospital District',
    mrf_url: 'https://machine-readable-files.com/seminole-hospital-district/751362671_Seminole-Hospital-District_standardcharges.csv',
    file_sha256: '0b20e2c6b28745378c09574c81b68a55438870c4dae86eaf6c244568a5c05b70',
    file_bytes: 2413314,
    declared_name: 'Seminole Hospital District',
    declared_location_name: 'Seminole Hospital District',
    declared_address: '209 NW 8TH St., Seminole, TX 79360',
    declared_type_2_npis: '1821025990',
    license_state: 'TX',
    last_updated: '2026-01-01'
  },
  '451386': {
    official_domain: 'https://mchd.net/',
    pointer_url: 'https://mchd.net/cms-hpt.txt',
    pointer_sha256: 'ef7d253aa80f8a777352d9ceb9f7afb12f4125da3b85fc43531316dcb8083f0d',
    pointer_location_name: 'Moore County Hospital District',
    mrf_url: 'https://moorecountyhospitaldistrict.pg.quadax.revenuemasters.com/cdm-files/751302152_moore-county-hospital-district_standardcharges.csv',
    file_sha256: '76f38cd0a99bb49d8b72942f0aa9a07b54d9d1667ee1cdc89ecc9f0e432e706c',
    file_bytes: 44081140,
    declared_name: 'Moore County Hospital District',
    declared_location_name: 'Moore County Hospital District',
    declared_address: '224 E 2nd St, Dumas, TX 79029',
    declared_type_2_npis: '751302152',
    license_state: 'TX',
    last_updated: '2026-03-30'
  }
};

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

for (const [ccn, r] of Object.entries(rows)) {
  const record = {
    ccn,
    observed_at: observedAt,
    proof_file: proofFile,
    official_domain: r.official_domain,
    pointer_url: r.pointer_url,
    pointer_status: 200,
    pointer_sha256: r.pointer_sha256,
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    pointer_location_name: r.pointer_location_name,
    pointer_declared_mrf_url: r.mrf_url,
    facility_file_url: r.mrf_url,
    file_status: 200,
    file_sample_bytes: r.file_bytes,
    file_sample_sha256: r.file_sha256,
    declared_hospital_name: r.declared_name,
    declared_location_name: r.declared_location_name,
    declared_address: r.declared_address,
    declared_type_2_npis: r.declared_type_2_npis,
    declared_license_state: r.license_state,
    declared_last_updated: r.last_updated,
    cms_template_version: '3.0.0',
    attestation: true,
    file_kind: 'csv',
    manual_identity: 'corroborated',
    manual_identity_gate: 'unique-pointer-entry-name-address-state-v3-attestation-agree',
    manual_disposition: 'verified-current-mrf',
    disposition: 'verified-current-mrf',
    next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. File hash is of the complete response.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows) }, null, 2));
