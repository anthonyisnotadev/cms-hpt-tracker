const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T17:00:00.075Z';
const pointerSha = '0e35da5d85ec40fe7596f10b6099b6a5840406fc7c36b9f56c10530d261f6787';
const proofFile = 'reconciliation-aspirus-520033-521324-521350-pointer-enumeration-proof-2026-10-01.json';
const rows = {
  '520033': {
    pointer_location_name: 'Aspirus Wisconsin Rapids Hospital',
    mrf_url: 'https://www.aspirus.org/Uploads/Public/Documents/PriceEstimate/TransparencyFY27/390868982_1295754844_aspirus-wisconsin-rapids-hospital_standardcharges.json',
    sample_sha256: '4d3a7eb534e0d3d32d765f25a80f897eb1356d1003d0882778cee8d85427bef4',
    declared_hospital_name: 'Aspirus Wisconsin Rapids Hospital',
    declared_address: '410 Dewey St, Wisconsin Rapids, WI 54495',
    declared_license_number: '11',
    declared_type_2_npis: '1295754844',
    identity_basis: 'Unique pointer entry matches the CCN\'s Wisconsin Rapids campus: roster ASPIRUS RIVERVIEW HOSPITAL & CLINICS INC is the former name of the facility Aspirus renamed to Aspirus Wisconsin Rapids Hospital (same 410 Dewey St campus); the retained standing FY26 mrf URL for this CCN is already the Wisconsin Rapids facility file. Header name, address, WI license, NPI 1295754844, 2026-04-01, CMS 3.0.0 and attestation agree.'
  },
  '521324': {
    pointer_location_name: 'Aspirus Medford Hospital',
    mrf_url: 'https://www.aspirus.org/Uploads/Public/Documents/PriceEstimate/TransparencyFY27/390964813_1619079597_aspirus-medford-hospital_standardcharges.json',
    sample_sha256: 'bb697ae27254a279c8684a42a7ab61f1d3acbeb1c6705cbd5ff87cda8a25e7a3',
    declared_hospital_name: 'Aspirus Medford Hospital',
    declared_address: '135 S Gibson St, Medford, WI 54451',
    declared_license_number: '1027',
    declared_type_2_npis: '1619079597|1427105923',
    identity_basis: 'Unique pointer entry matches roster ASPIRUS MEDFORD HOSPITAL & CLINICS, INC (MEDFORD, WI); header name, Medford address, WI license, NPI 1619079597, 2026-04-01, CMS 3.0.0 and attestation agree.'
  },
  '521350': {
    pointer_location_name: 'Aspirus Langlade Hospital',
    mrf_url: 'https://www.aspirus.org/Uploads/Public/Documents/PriceEstimate/TransparencyFY27/390806429_1639187412_aspirus-langlade-hospital_standardcharges.json',
    sample_sha256: '11ee9b926165e30edca31ddd5d6ee86f224cc786a9ad0fc6fc8814306f684a33',
    declared_hospital_name: 'Aspirus Langlade Hospital',
    declared_address: '112 E Fifth Ave, Antigo, WI 54409',
    declared_license_number: '1055',
    declared_type_2_npis: '1639187412|1801950746',
    identity_basis: 'Unique pointer entry matches roster LANGLADE HOSPITAL (ANTIGO, WI); header name, Antigo address, WI license, NPI 1639187412, 2026-04-01, CMS 3.0.0 and attestation agree.'
  }
};

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

for (const [ccn, r] of Object.entries(rows)) {
  const record = {
    ccn,
    observed_at: observedAt,
    proof_file: proofFile,
    official_domain: 'https://www.aspirus.org/',
    pointer_url: 'https://www.aspirus.org/cms-hpt.txt',
    pointer_status: 200,
    pointer_sha256: pointerSha,
    pointer_entry_count: 18,
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
    declared_license_number: r.declared_license_number,
    declared_type_2_npis: r.declared_type_2_npis,
    declared_license_state: 'WI',
    declared_last_updated: '2026-04-01',
    cms_template_version: '3.0.0',
    attestation: true,
    file_kind: 'json',
    identity_basis: r.identity_basis,
    manual_identity: 'corroborated',
    manual_identity_gate: 'unique-pointer-entry-npi-name-address-state-v3-attestation-agree-no-sibling-2026-10-01',
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
