const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const observedAt = '2026-10-01T14:24:34Z';
const pointer = {
  pointer_url: 'https://ummhealth.org/cms-hpt.txt',
  pointer_status: 200,
  pointer_bytes: 3037,
  pointer_last_modified: '2026-10-01T02:29:49Z',
  source_page_url: 'https://www.ummhealth.org/patients-visitors/price-transparency'
};
const rows = {
  '220049': {
    proof: 'reconciliation-ummass-220049-current-pointer-proof-2026-10-01.json',
    pointer_entry_name: 'UMass Memorial Medical Center-Marlborough Campus',
    mrf_url: 'https://d1477x5i4cdpk9.cloudfront.net/043358564_umass-memorial-medical-center-inc._standardcharges.csv',
    mrf_status: 206,
    mrf_sample_bytes: 262144,
    mrf_sample_sha256: 'b059b0b74b609ca96db5ed5f6e5919d2b4046666396660d0c2d6c5d52e4a4d4f',
    mrf_last_modified: '2026-03-31T20:30:57Z',
    declared_hospital_name: 'UMass Memorial Medical Center',
    declared_location_name: 'UMass Memorial Medical Center Memorial Campus|UMass Memorial Medical Center University Campus|UMass Memorial Medical Center-North Pavilion|UMass Memorial Medical Center-Marlborough Campus',
    declared_address: '119 Belmont Street Worcester, MA 01605|55 Lake Avenue North Worcester, MA 01655|378 Plantation St Worcester, MA 01605|157 Union Street Marlborough, MA 01752',
    declared_license_state: 'MA',
    declared_last_updated: '2026-03-26',
    cms_template_version: '3.0.0',
    attestation: true,
    attester: 'Brian Huggins, SVP Finance/Corp Controller',
    identity_basis: 'The 2026-10-01 root pointer has a dedicated location entry, UMass Memorial Medical Center-Marlborough Campus, whose target CSV header (bounded 262,144-byte sample, SHA-256 b059b0b74b609ca96db5ed5f6e5919d2b4046666396660d0c2d6c5d52e4a4d4f) declares that campus at 157 Union Street Marlborough, MA 01752 with MA license, 2026-03-26 date, CMS 3.0.0, and a TRUE attestation. This is the publisher-declared multi-campus assignment for CCN 220049, not a sibling file; no separate Marlborough Hospital entry exists in the root pointer.',
    gate: 'official-pointer-multi-campus-entry-csv-exact-campus-name-address-state-date-template-attestation-agree',
    next_step: 'Retain as verified current MRF and recheck on the next pointer update.'
  },
  '220090': {
    proof: 'reconciliation-ummass-220090-current-pointer-proof-2026-10-01.json',
    pointer_entry_name: 'UMass Memorial Health-Milford Regional Medical Center',
    mrf_url: 'https://d1477x5i4cdpk9.cloudfront.net/042103602_umass-memorial-health-milford-regional-medical-center-inc._standardcharges.csv',
    mrf_status: 206,
    mrf_sample_bytes: 262144,
    mrf_sample_sha256: '68f7a2a8f6fc00187873512dd545cb1d366e3153f9a1410a83cbbb637ddf9e8b',
    mrf_last_modified: '2026-04-10T14:56:12Z',
    declared_hospital_name: 'UMass Memorial Health - Milford Regional Medical Center, Inc.',
    declared_location_name: 'UMass Memorial Health - Milford Regional Medical Center',
    declared_address: '14 Prospect St, Milford, MA 01757',
    declared_license_state: 'MA',
    declared_last_updated: '2026-04-01',
    cms_template_version: '3.0.0',
    attestation: true,
    attester: 'Steven McCue, VP CFO Community Hospitals',
    identity_basis: 'The 2026-10-01 root pointer has a dedicated facility entry whose target CSV header (bounded 262,144-byte sample, SHA-256 68f7a2a8f6fc00187873512dd545cb1d366e3153f9a1410a83cbbb637ddf9e8b) declares UMass Memorial Health - Milford Regional Medical Center, Inc. at 14 Prospect St, Milford, MA 01757, type-2 NPI 1477527497, MA license 2105, 2026-04-01 date, CMS 3.0.0, and a TRUE attestation. Exact facility name/address/state match for CCN 220090.',
    gate: 'official-pointer-dedicated-entry-csv-exact-name-address-state-date-template-attestation-agree',
    next_step: 'Retain as verified current MRF and recheck on the next pointer update.'
  }
};
for (const [ccn, row] of Object.entries(rows)) {
  const proof = {
    ccn,
    observed_at: observedAt,
    official_domain: 'https://www.ummhealth.org/',
    domain_search: {
      query: `"${ccn === '220049' ? 'Marlborough Hospital' : 'Milford Regional Medical Center'}" ${ccn === '220049' ? 'Marlborough' : 'Milford'} MA price transparency standard charges`,
      found_domain: 'https://www.ummhealth.org/patients-visitors/price-transparency',
      agrees: true,
      basis: 'First-party UMass Memorial Health price-transparency page is the official route for both facilities; no third-party domain used.'
    },
    ...pointer,
    pointer_entry_location_name: row.pointer_entry_name,
    pointer_declared_mrf_url: row.mrf_url,
    mrf_url: row.mrf_url,
    mrf_status: row.mrf_status,
    mrf_sample_bytes: row.mrf_sample_bytes,
    mrf_sample_sha256: row.mrf_sample_sha256,
    mrf_last_modified: row.mrf_last_modified,
    declared_hospital_name: row.declared_hospital_name,
    declared_location_name: row.declared_location_name,
    declared_address: row.declared_address,
    declared_license_state: row.declared_license_state,
    declared_last_updated: row.declared_last_updated,
    cms_template_version: row.cms_template_version,
    attestation: row.attestation,
    attester_name: row.attester,
    file_kind: 'csv',
    identity_basis: row.identity_basis,
    not_established: 'The sample hash covers the first 262,144 bytes only (bounded sample), not the complete file; full-file equality beyond the header region is not asserted.',
    next_action: row.next_step
  };
  fs.writeFileSync(path.join(audit, row.proof), JSON.stringify(proof, null, 2) + '\n');
  const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
  manual.records = manual.records.filter(r => r.ccn !== ccn);
  manual.records.push({
    ccn,
    observed_at: observedAt,
    official_domain: 'https://www.ummhealth.org/',
    ...pointer,
    pointer_entry_location_name: row.pointer_entry_name,
    pointer_declared_mrf_url: row.mrf_url,
    mrf_url: row.mrf_url,
    mrf_status: row.mrf_status,
    mrf_sample_bytes: row.mrf_sample_bytes,
    mrf_sample_sha256: row.mrf_sample_sha256,
    mrf_last_modified: row.mrf_last_modified,
    declared_hospital_name: row.declared_hospital_name,
    declared_location_name: row.declared_location_name,
    declared_address: row.declared_address,
    declared_license_state: row.declared_license_state,
    declared_last_updated: row.declared_last_updated,
    cms_template_version: row.cms_template_version,
    attestation: row.attestation,
    file_kind: 'csv',
    identity_basis: row.identity_basis,
    proof_file: row.proof,
    manual_disposition: 'verified-current-mrf',
    disposition: 'verified-current-mrf',
    manual_identity_gate: row.gate,
    next_action: row.next_step
  });
  manual.records.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
  fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
  console.log(`applied ${ccn}`);
}
