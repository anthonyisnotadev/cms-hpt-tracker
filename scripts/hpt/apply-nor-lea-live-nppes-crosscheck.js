'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofFile = 'reconciliation-nor-lea-live-nppes-license-and-address-crosscheck-2026-09-27.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofFile), 'utf8'));

const browserPath = path.join(audit, 'nationwide-browser-reviews.json');
const browserData = JSON.parse(fs.readFileSync(browserPath, 'utf8'));
const browserRecords = Array.isArray(browserData) ? browserData : browserData.records;
if (!Array.isArray(browserRecords)) throw new Error('Unexpected nationwide browser review shape');
const review = {
  kind: 'official-nppes-api-address-license-crosscheck',
  target: proof.nppes_api.url,
  final_url: proof.nppes_api.url,
  status: 'official-nppes-200-address-and-license-crosscheck',
  title: 'Nor-Lea live CMS NPPES API and NM DOH facility-ID cross-check',
  detail: `Live CMS NPPES API returned the exact Nor-Lea organization/NPI with location ${proof.nppes_api.location_address}, primary-taxonomy license ${proof.nppes_api.primary_taxonomy_license}/${proof.nppes_api.primary_taxonomy_license_state}, record updated ${proof.nppes_api.record_last_updated}; response ${proof.nppes_api.response_bytes} bytes, SHA-256 ${proof.nppes_api.response_sha256}. NM DOH's 2015 Appendix B separately lists facility ID 3102 for Nor Lea Hospital District. The state appendix is not a license record and neither source supports the MRF's 1900 North Main address. The existing complete MRF hash and literal are retained; no file re-fetch was done because the 9/25 complete-file hash remains the current observation.`,
  browser: 'official-nppes-api-and-nm-doh-document-review',
  http_status: 200,
  bytes_read: proof.nppes_api.response_bytes,
  identity: 'official-nppes-exact-npi-and-campus-address-with-mrf-address-conflict-retained',
  declared_hospital_name: 'NOR-LEA HOSPITAL DISTRICT',
  declared_location_name: 'Nor-Lea Hospital District',
  declared_address: proof.nppes_api.location_address,
  declared_license_state: 'NM',
  declared_last_updated: proof.nppes_api.record_last_updated,
  cms_template_version: '',
  observed_at: proof.observed_at,
  ccn: proof.ccn,
  source_page_url: proof.nppes_api.url,
  pointer_url: 'https://nor-lea.org/resources',
  mrf_url: proof.existing_hash_bound_file_proof.mrf_url,
  file_sha256: proof.existing_hash_bound_file_proof.full_file_sha256,
  next_action: proof.next_action,
  proof_file: proofFile
};
const idx = browserRecords.findIndex((record) => record.ccn === proof.ccn && record.kind === review.kind);
if (idx >= 0) browserRecords[idx] = review;
else browserRecords.push(review);
if (Array.isArray(browserData)) fs.writeFileSync(browserPath, `${JSON.stringify(browserRecords, null, 2)}\n`);
else fs.writeFileSync(browserPath, `${JSON.stringify(browserData, null, 2)}\n`);

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const manualRecord = manual.records.find((record) => record.ccn === proof.ccn);
if (!manualRecord) throw new Error(`Missing manual observation for ${proof.ccn}`);
manualRecord.live_nppes_and_nm_doh_crosscheck_2026_09_27 = {
  observed_at: proof.observed_at,
  proof_file: proofFile,
  finding: proof.finding,
  disposition: proof.disposition,
  count_effect: proof.count_effect,
  next_action: proof.next_action
};
manualRecord.next_action = proof.next_action;
fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);

const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const entry = ledger.find((record) => record.ccn === proof.ccn);
if (!entry) throw new Error(`Missing reviewed resolution for ${proof.ccn}`);
entry.live_nppes_and_nm_doh_crosscheck_2026_09_27 = manualRecord.live_nppes_and_nm_doh_crosscheck_2026_09_27;
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

console.log(JSON.stringify({
  ccn: proof.ccn,
  disposition: proof.disposition,
  count_effect: proof.count_effect,
  preserved_finding: entry.finding,
  next_action: proof.next_action
}, null, 2));
