'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofFile = 'reconciliation-shoshone-secondary-file-lead-recheck-2026-09-27.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofFile), 'utf8'));
const browserPath = path.join(audit, 'nationwide-browser-reviews.json');
const browserData = JSON.parse(fs.readFileSync(browserPath, 'utf8'));
const browserRecords = Array.isArray(browserData) ? browserData : browserData.records;
if (!Array.isArray(browserRecords)) throw new Error('Unexpected nationwide browser review shape');

const review = {
  kind: 'third-party-mrf-download-lead-recheck',
  target: proof.candidate_blob_url,
  final_url: proof.candidate_blob_url,
  status: 'source-tracker-previously-captured-origin-404',
  title: 'Shoshone Medical Center third-party file lead recheck',
  detail: 'ShowTheBill says its 46.8 MB Shoshone CSV was retrieved 2026-08-28 and links this alternate blob object, distinct from the current malformed #1 pointer target. A direct HEAD on 2026-09-27 returned Azure Blob 404, “The specified blob does not exist.” No file bytes, header, publisher linkage or current metadata were recovered; this lead does not replace the 2020 official-page chargemaster or resolve the current MRF gate.',
  browser: 'third-party-search-result-and-bounded-curl-head',
  http_status: 404,
  bytes_read: 0,
  content_range: '',
  identity: 'alternate-shoshone-file-lead-origin-unavailable',
  declared_hospital_name: '',
  declared_location_name: '',
  declared_address: '',
  declared_license_state: '',
  declared_last_updated: '',
  cms_template_version: '',
  observed_at: proof.observed_at,
  ccn: proof.ccn,
  source_page_url: proof.secondary_discovery_page,
  pointer_url: proof.first_party_pointer_url,
  mrf_url: proof.candidate_blob_url,
  file_sha256: '',
  next_action: proof.next_action,
  proof_file: proofFile
};
const index = browserRecords.findIndex((record) => record.ccn === proof.ccn && record.kind === review.kind && record.target === review.target);
if (index >= 0) browserRecords[index] = review;
else browserRecords.push(review);
if (Array.isArray(browserData)) fs.writeFileSync(browserPath, `${JSON.stringify(browserRecords, null, 2)}\n`);
else fs.writeFileSync(browserPath, `${JSON.stringify(browserData, null, 2)}\n`);

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
const manualRecord = manual.records.find((record) => record.ccn === proof.ccn);
if (!manualRecord) throw new Error(`Missing manual observation for ${proof.ccn}`);
manualRecord.third_party_file_lead_recheck_2026_09_27 = {
  observed_at: proof.observed_at,
  proof_file: proofFile,
  candidate_blob_url: proof.candidate_blob_url,
  http_status: proof.candidate_blob_head.http_status,
  result: proof.disposition,
  interpretation: proof.interpretation,
  count_effect: proof.count_effect,
  next_action: proof.next_action
};
manualRecord.next_action = proof.next_action;
fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);

const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const entry = ledger.find((record) => record.ccn === proof.ccn);
if (entry) {
  entry.third_party_file_lead_recheck_2026_09_27 = manualRecord.third_party_file_lead_recheck_2026_09_27;
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}

console.log(JSON.stringify({
  ccn: proof.ccn,
  disposition: proof.disposition,
  count_effect: proof.count_effect,
  reviewed_resolution_entry: Boolean(entry),
  retained_pointer_result: manualRecord.disposition,
  retained_legacy_file: manualRecord.legacy_page_file_sha256
}, null, 2));
