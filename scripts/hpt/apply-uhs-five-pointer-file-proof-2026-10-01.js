const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T19:25:47.382Z';
const proofFile = 'reconciliation-uhs-five-pointer-mrf-webreader-proof-2026-10-01.json';

const rows = {
  '454109': {
    official_domain: 'https://elpasobh.com/',
    pointer_url: 'https://elpasobh.com/cms-hpt.txt',
    pointer_sha256: 'f03045f192cfe3be86aacd5984709eb9501387885ca1db2686a75e15831b1de8',
    pointer_location_name: 'El Paso Behavioral Health System',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/208364461_el-paso_standardcharges.csv',
    file_sha256: '113468caa2f674f5af2684d84817d2aa528d460df4f054c9f970c5722ca3e8f1',
    file_bytes: 431525,
    declared_name: 'El Paso Behavioral Health',
    declared_address: '1900 Denver Avenue, El Paso, TX 79902',
    declared_type_2_npis: '1386779304',
    license_state: 'TX',
    last_updated: '2026-08-31'
  },
  '104073': {
    official_domain: 'https://emeraldcoastbehavioral.com/',
    pointer_url: 'https://emeraldcoastbehavioral.com/cms-hpt.txt',
    pointer_sha256: '4a1a5b0ccfafd0a00561d5bc41fe6644b69d50689eced03dc06e414328484261',
    pointer_location_name: 'Emerald Coast Behavioral Hospital',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/270720873_emerald-coast_standardcharges.csv',
    file_sha256: 'e4aa6355086c9653af9f4847236d03972f5d5b5109aba088ca4782b4985d4c78',
    file_bytes: 53252,
    declared_name: 'Emerald Coast Behavioral Health',
    declared_address: '1940 Harrison Ave, Panama City, FL 32405',
    declared_type_2_npis: '1578795332',
    license_state: 'FL',
    last_updated: '2026-05-14'
  },
  '504002': {
    official_domain: 'https://fairfaxhospital.com/',
    pointer_url: 'https://fairfaxhospital.com/cms-hpt.txt',
    pointer_sha256: 'bf90b4716b54013d1bf8bfff6b3a8d09db84c871bb574efd0fcc1b938abb2fe1',
    pointer_location_name: 'Fairfax Hospital',
    pointer_entry_count: 3,
    pointer_entries_matching_facility: 1,
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/621658528_fairfax_standardcharges.csv',
    file_sha256: '9794172359fcf7d1988f0ca475d14607561a54c2eb723e4b22965e88f0182c39',
    file_bytes: 120487,
    declared_name: 'Fairfax Behavioral Health',
    declared_address: '10200 NE 132nd Street, Kirkland, WA 98034',
    declared_type_2_npis: '1053327890',
    license_state: 'WA',
    last_updated: '2026-05-11'
  },
  '394027': {
    official_domain: 'https://fairmountbhs.com/',
    pointer_url: 'https://fairmountbhs.com/cms-hpt.txt',
    pointer_sha256: '503f9eb7e5d4526b7ab9fc0623c6170860ac767b498ade4472990939755ce5cd',
    pointer_location_name: 'Fairmount Behavioral Health System',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/233044432_fairmount_standardcharges.csv',
    file_sha256: 'cd3f9bf6ece10767616b18280edb7c7903f197c5381abb043dd35ff50a95e836',
    file_bytes: 84328,
    declared_name: 'Fairmount Behavioral Health System',
    declared_address: '561 Fairthorne Ave, Philadelphia, PA 19128',
    declared_type_2_npis: '1215902168',
    license_state: 'PA',
    last_updated: '2026-09-02'
  },
  '234030': {
    official_domain: 'https://www.forestviewhospital.com/',
    pointer_url: 'https://www.forestviewhospital.com/cms-hpt.txt',
    pointer_sha256: '4ec4da3f4cb0f421c436e0ecca83b8cc2d8ec3f92614accdf0cbea4bf9494860',
    pointer_location_name: 'Forest View Hospital',
    pointer_entry_count: 1,
    pointer_entries_matching_facility: 1,
    mrf_url: 'https://uhsfilecdn.eskycity.net/bh/232285657_forest-view_standardcharges.csv',
    file_sha256: '8b3a1fd2c38585c2ecda280592c5fe25e6604f541afb11e55a203cf098822c5',
    file_bytes: 33879,
    declared_name: 'Forest View',
    declared_address: '1055 Medical Park Drive SE, Grand Rapids, MI 49546',
    declared_type_2_npis: '1740251313',
    license_state: 'MI',
    last_updated: '2026-08-31'
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
    pointer_entry_count: r.pointer_entry_count,
    pointer_entries_matching_facility: r.pointer_entries_matching_facility,
    pointer_location_name: r.pointer_location_name,
    pointer_declared_mrf_url: r.mrf_url,
    facility_file_url: r.mrf_url,
    file_status: 200,
    file_sample_bytes: r.file_bytes,
    file_sample_sha256: r.file_sha256,
    declared_hospital_name: r.declared_name,
    declared_location_name: r.declared_name,
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
    next_action: 'Retain the pointer-to-file chain; recheck on next publisher pointer or file change. Pointer hashes are of reader-extracted text; exact pointer wire bytes remain unestablished.'
  };
  manual.records = manual.records.filter(x => x.ccn !== ccn);
  manual.records.push(record);
}
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: Object.keys(rows) }, null, 2));
