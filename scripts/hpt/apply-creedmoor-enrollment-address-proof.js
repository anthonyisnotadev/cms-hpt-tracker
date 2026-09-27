'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const { parseSections } = require('./audit-omh-multisection-file');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofFile = 'reconciliation-creedmoor-current-enrollment-address-proof-2026-09-27.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofFile), 'utf8'));
const read = name => JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(audit, name), `${JSON.stringify(value, null, 2)}\n`);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

const cms = proof.current_cms_hospital_enrollment;
const cmsResponse = Buffer.from(cms.response_body, 'utf8');
const [enrollment] = JSON.parse(cms.response_body);
const pointerPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/omh.ny.gov-5b73748273a2.txt');
const pointer = fs.readFileSync(pointerPath);
const fullFilePath = path.join(audit, '.domain-discovery/reconciliation/omh-shared/file.bin');
const fullFile = fs.readFileSync(fullFilePath);
const section = parseSections(fullFile).find(item => item.section_name === proof.retained_pointer_and_mrf.mrf_section_name);
const expectedSection = proof.retained_pointer_and_mrf;

if (proof.ccn !== '334004' || hash(cmsResponse) !== cms.response_sha256
  || cmsResponse.length !== cms.response_bytes || cms.response_status !== 200
  || enrollment.CCN !== '334004' || enrollment.NPI !== '1194889097'
  || enrollment['DOING BUSINESS AS NAME'] !== 'CREEDMOOR PSYCHIATRIC CENTER'
  || enrollment['ADDRESS LINE 1'] !== '79-25 WINCHESTER BOULEVARD'
  || enrollment.CITY !== 'QUEENS VILLAGE' || enrollment.STATE !== 'NY'
  || enrollment['SUBGROUP - PSYCHIATRIC'] !== 'Y')
  throw new Error('Retained CMS Hospital Enrollments response does not prove the exact Creedmoor CCN/name/NPI/address/state record');
if (hash(pointer) !== expectedSection.pointer_sha256
  || !pointer.toString('utf8').includes(`location-name: ${expectedSection.pointer_location_name}`)
  || !pointer.toString('utf8').includes(`mrf-url: ${expectedSection.pointer_mrf_url}`))
  throw new Error('The retained OMH pointer hash or Creedmoor file target changed');
if (hash(fullFile) !== expectedSection.mrf_full_file_sha256
  || fullFile.length !== expectedSection.mrf_full_file_bytes || !section
  || section.address !== expectedSection.mrf_section_address
  || section.declared_date_raw !== '5/28/2026' || section.version !== '3.0.0'
  || section.license_state !== 'NY' || section.attestation !== true
  || section.columns !== 51 || section.data_rows !== 88 || section.malformed_row_widths !== 0
  || !section.declared_npis.includes('1194889097') || section.usable_gross_charge_rows !== 88)
  throw new Error('The retained exact OMH MRF bytes no longer satisfy the Creedmoor section proof');

const compliance = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
const base = compliance.find(row => row.ccn === proof.ccn);
if (!base) throw new Error('Missing exact CCN 334004 base record');

const ledger = read('reviewed-resolutions.json');
const evidenceRun = 'creedmoor-current-cms-enrollment-address-crosswalk-2026-09-27';
const evidence = {
  identity: 'corroborated',
  identity_basis: proof.resolution.identity_basis,
  officialDomain: 'omh.ny.gov',
  pointerUrl: expectedSection.pointer_url,
  pointerSha256: expectedSection.pointer_sha256,
  pointerLocationName: expectedSection.pointer_location_name,
  sourcePageUrl: expectedSection.source_page_url,
  url: expectedSection.pointer_mrf_url,
  finalUrl: expectedSection.pointer_mrf_url,
  http_status: expectedSection.mrf_http_status,
  checked_at: proof.observed_at,
  date: '2026-05-28',
  version: '3.0.0',
  declared_hospital_name: expectedSection.mrf_section_name,
  location_name: expectedSection.mrf_section_location_name,
  declared_address: expectedSection.mrf_section_address,
  facility_address: '79-25 WINCHESTER BOULEVARD, QUEENS VILLAGE, NY 11427-2199',
  declared_license_state: 'NY',
  facility_state: 'NY',
  file_kind: 'csv',
  fileSha256: expectedSection.mrf_full_file_sha256,
  fullFileBytes: expectedSection.mrf_full_file_bytes,
  columns: expectedSection.mrf_columns,
  dataRows: expectedSection.mrf_rows,
  malformedRowWidths: expectedSection.mrf_malformed_row_widths,
  attestationPresent: expectedSection.mrf_attestation,
  fileSectionCount: 20,
  declaredNpis: expectedSection.mrf_section_declared_npis,
  cmsRosterDataset: cms.dataset,
  cmsRosterDatasetUrl: cms.dataset_landing_page,
  cmsRosterQueryUrl: cms.dataset_api_url,
  cmsRosterResponseSha256: cms.response_sha256,
  cmsEnrollmentVersion: cms.dataset_version,
  cmsEnrollmentId: enrollment['ENROLLMENT ID'],
  cmsEnrollmentNpi: enrollment.NPI,
  cmsGeneralInformationAddressVariation: proof.prior_conflict.cms_hospital_general_information_address,
  observedFinding: 'date-within-365-days-version-3',
};
const resolution = {
  ccn: proof.ccn,
  base,
  action: 'replace',
  finding: 'verified-current-mrf',
  evidence,
  evidence_run: evidenceRun,
  reviewed_at: proof.observed_at,
  note: `${proof.resolution.identity_basis} The exact file is 929,041 bytes, hash ${expectedSection.mrf_full_file_sha256}; its 88-row, 51-column Creedmoor section declares NY, date 2026-05-28, CMS 3.0.0, attestation, and includes NPI 1194889097. OMH separately identifies 80-45 Winchester Building 73 as an outpatient site. The older CMS Hospital General Information 80-45 address is retained as a distinct source variation; current CMS Hospital Enrollments (PECOS) and the OMH main-campus record identify the MRF address at 79-25. This is observed current-file evidence, not a legal compliance or line-item validation claim.`,
};
const oldResolution = ledger.find(item => item.ccn === proof.ccn);
if (oldResolution && oldResolution.evidence_run !== evidenceRun)
  throw new Error('A different reviewed resolution already exists for CCN 334004');
if (!oldResolution) ledger.push(resolution);
write('reviewed-resolutions.json', ledger);

const manual = read('reconciliation-manual-access-observations.json');
const manualObservation = {
  ccn: proof.ccn,
  observed_at: proof.observed_at,
  proof_file: proofFile,
  official_site: proof.official_omh_browser_observations[0].url,
  official_pricing_page: expectedSection.source_page_url,
  official_page_address: '79-25 Winchester Boulevard, Queens Village, NY 11427-2199',
  cms_enrollment_dataset: cms.dataset,
  cms_enrollment_dataset_url: cms.dataset_landing_page,
  cms_enrollment_api_url: cms.dataset_api_url,
  cms_enrollment_response_sha256: cms.response_sha256,
  cms_enrollment_npi: enrollment.NPI,
  cms_enrollment_address: enrollment['ADDRESS LINE 1'],
  prior_cms_hospital_general_information_address: proof.prior_conflict.cms_hospital_general_information_address,
  pointer_url: expectedSection.pointer_url,
  pointer_sha256: expectedSection.pointer_sha256,
  pointer_location_name: expectedSection.pointer_location_name,
  pointer_mrf_url: expectedSection.pointer_mrf_url,
  complete_file_sha256: expectedSection.mrf_full_file_sha256,
  file_declared_hospital_name: expectedSection.mrf_section_name,
  file_declared_address: expectedSection.mrf_section_address,
  file_declared_license_state: 'NY',
  file_declared_date: '2026-05-28',
  file_declared_version: '3.0.0',
  file_declared_npis: expectedSection.mrf_section_declared_npis,
  disposition: 'verified-current-mrf-cms-enrollment-main-campus-crosswalk',
  interpretation: proof.resolution.scope_limit,
  next_action: proof.resolution.next_action,
};
const manualExisting = manual.records.find(item => item.ccn === proof.ccn && item.proof_file === proofFile);
if (manualExisting) Object.assign(manualExisting, manualObservation);
else manual.records.push(manualObservation);
write('reconciliation-manual-access-observations.json', manual);

const browser = read('nationwide-browser-reviews.json');
for (const item of proof.official_omh_browser_observations) {
  if (!browser.records.some(record => record.kind === 'official-facility-page-address-role-review'
    && record.ccn === proof.ccn && record.target === item.url && record.proof_file === proofFile)) {
    browser.records.push({
      kind: 'official-facility-page-address-role-review',
      ccn: proof.ccn,
      target: item.url,
      final_url: item.url,
      status: 'rendered-first-party-page-content-reviewed',
      observed_at: item.observed_at,
      title: item.browser_title,
      detail: item.observation,
      browser: 'codex-in-app-browser-accessibility-document-text',
      proof_file: proofFile,
    });
  }
}
write('nationwide-browser-reviews.json', browser);

console.log(JSON.stringify({ ccn: proof.ccn, evidenceRun, mrfSha256: expectedSection.mrf_full_file_sha256,
  cmsResponseSha256: cms.response_sha256, resolution: oldResolution ? 'already-applied' : 'added' }));
