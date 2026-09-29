'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-clinton-reh-transition-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === '370784');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));

if (!base || base.finding !== 'not-assessed-domain-unknown' || base.pointer_url || base.mrf_url
  || proof.ccns.join(',') !== '370245,370784'
  || proof.cms_current_enrollment.ccn !== '370784'
  || proof.cms_current_enrollment.former_hospital_ccn !== '370245'
  || proof.cms_current_enrollment.reh_conversion_date !== '2025-12-02'
  || proof.cms_current_enrollment.npi !== proof.file_type_2_npi[0]
  || proof.file_hospital_name !== 'Clinton Regional Hospital'
  || proof.file_address.join('|') !== '100 North 30th Street, Clinton, OK 73601'
  || proof.file_license_state !== 'OK' || proof.file_last_updated_on !== '2026-07-28'
  || proof.file_version !== '3.0.0' || proof.file_http_status !== 200 || proof.file_bytes !== 3871397
  || proof.charge_entry_count !== 4761
  || !proof.pointer_entry_without_contacts.includes(`mrf-url: ${proof.pointer_file_url}`)
  || !proof.pointer_entry_without_contacts.includes(`source-page-url: ${proof.pricing_page_url}`)
  || ![proof.cms_current_enrollment_response_sha256, proof.cms_former_enrollment_response_sha256,
    proof.first_party_site_sha256, proof.pointer_sha256, proof.pricing_page_sha256, proof.file_sha256]
    .every(value => /^[a-f0-9]{64}$/.test(value))
  || Date.parse(proof.observed_at) - Date.parse(proof.file_last_updated_on) > 365 * 86400000)
  throw new Error('Clinton proof or base does not meet current REH promotion gates');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'cms-current-reh-conversion-enrollment-npi-first-party-site-root-pointer-and-complete-json-name-address-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  url: proof.pointer_file_url, fileSha256: proof.file_sha256, fullFileBytes: proof.file_bytes,
  http_status: proof.file_http_status, checked_at: proof.observed_at,
  date: proof.file_last_updated_on, version: proof.file_version,
  officialDomain: 'crhaok.com', location_name: proof.file_location_name[0],
  declared_hospital_name: proof.file_hospital_name, declared_address: proof.file_address[0],
  declared_license_state: proof.file_license_state, file_kind: 'json',
  sourcePageUrl: proof.pricing_page_url, sourcePageSha256: proof.pricing_page_sha256,
  identityPageUrl: proof.first_party_site_url, identityPageSha256: proof.first_party_site_sha256,
  cmsEnrollmentUrl: proof.cms_current_enrollment_url,
  cmsEnrollmentSha256: proof.cms_current_enrollment_response_sha256,
  cmsNpi: proof.cms_current_enrollment.npi,
  formerHospitalCcn: proof.cms_current_enrollment.former_hospital_ccn,
  rehConversionDate: proof.cms_current_enrollment.reh_conversion_date,
};
const entry = {
  ccn: '370784', base, action: 'replace', evidence,
  evidence_run: 'clinton-reh-complete-file-review-2026-09-17', reviewed_at: proof.observed_at,
  note: 'CMS current enrollment identifies REH CCN 370784 as converted from former hospital CCN 370245 on 2025-12-02. The current first-party site, exact root pointer, and complete SHA-256-bound JSON agree on Clinton Regional Hospital, 100 North 30th Street, Oklahoma and NPI 1942921929. The file declares 2026-07-28 and v3.0.0. This is CCN-specific identity, access and metadata observation, not line-item validation or a legal compliance verdict. The former CCN does not inherit this file.',
};
const existing = ledger.find(row => row.ccn === entry.ccn);
if (existing) {
  if (existing.evidence_run !== entry.evidence_run || JSON.stringify(existing.evidence) !== JSON.stringify(evidence))
    throw new Error('Existing nonmatching Clinton resolution');
  console.log(JSON.stringify({ applied: false, ccn: entry.ccn }));
} else {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ applied: true, ccn: entry.ccn }));
}
