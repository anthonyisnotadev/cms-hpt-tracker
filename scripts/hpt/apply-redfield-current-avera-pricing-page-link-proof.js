const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofFile = 'reconciliation-redfield-current-avera-pricing-page-link-proof-2026-09-27.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofFile), 'utf8'));
const browserPath = path.join(audit, 'nationwide-browser-reviews.json');
const browser = JSON.parse(fs.readFileSync(browserPath, 'utf8'));
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));

const observation = {
  kind: 'current-official-pricing-page-and-pointer-file-link-observation',
  target: proof.mrf_url,
  final_url: proof.mrf_url,
  status: 'official-current-page-links-exact-pointer-file-client-access-denied',
  title: 'Avera current Redfield standard-charges page and exact MRF link',
  detail: `${proof.evidence_gained} Direct bounded retrieval returned HTTP ${proof.retrieval.direct_http_status} before CSV bytes; the in-app browser also rendered an access-denied page. The page reader resolved the CSV link but could not expose its content. This does not establish file absence or noncompliance.`,
  browser: 'web-page-link-resolution-bounded-range-and-codex-in-app-browser',
  http_status: proof.retrieval.direct_http_status,
  bytes_read: proof.retrieval.direct_response_bytes,
  identity: 'current-official-page-and-prior-pointer-link-agree-redfield-file-by-url-only',
  declared_hospital_name: proof.hospital_name,
  declared_location_name: 'Redfield Community Memorial',
  declared_address: '111 W 10th Ave, Redfield, SD 57469',
  declared_license_state: '',
  declared_last_updated: '',
  cms_template_version: '',
  observed_at: proof.observed_at,
  ccn: proof.ccn,
  source_page_url: proof.source_url,
  official_page_url: proof.source_url,
  pointer_url: proof.prior_pointer_url,
  pointer_sha256: proof.prior_pointer_sha256,
  mrf_url: proof.mrf_url,
  file_sha256: '',
  next_action: proof.next_action,
  proof_file: proofFile,
  recheck_reason: 'Searched the exact CCN after the prior Avera page/browser route remained access-blocked; a current official Avera pricing page surfaced and independently listed the exact pointer URL with a July 20, 2026 label. The file itself remains inaccessible, so this is a page/link provenance gain only.'
};

const index = browser.records.findIndex((row) => row.ccn === proof.ccn && row.kind === observation.kind && row.mrf_url === proof.mrf_url);
if (index >= 0) browser.records[index] = observation;
else browser.records.push(observation);
browser.updated_at = proof.observed_at;
fs.writeFileSync(browserPath, JSON.stringify(browser, null, 2) + '\n');

const manualIndex = manual.records.findIndex((row) => row.ccn === proof.ccn);
if (manualIndex < 0) throw new Error(`Manual access observation missing for ${proof.ccn}; refusing to create an incomplete record`);
const manualRow = manual.records[manualIndex];
manualRow.observed_at = proof.observed_at;
manualRow.proof_file = proofFile;
manualRow.avera_current_pricing_page_url = proof.source_url;
manualRow.avera_current_pointer_file_url = proof.mrf_url;
manualRow.latest_current_pricing_page_link_2026_09_27 = {
  observed_at: proof.observed_at,
  proof_file: proofFile,
  source_url: proof.source_url,
  page_label_date: '2026-07-20',
  mrf_url: proof.mrf_url,
  matches_prior_pointer_target: true,
  retrieval_http_status: proof.retrieval.direct_http_status,
  response_sha256: proof.retrieval.direct_response_sha256,
  browser_result: proof.retrieval.browser_result,
  page_reader_result: proof.retrieval.page_link_resolution,
  disposition: proof.disposition,
  count_effect: 0,
  next_action: proof.next_action
};
manualRow.next_action = proof.next_action;
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');

console.log(JSON.stringify({ applied: true, ccn: proof.ccn, browserAction: index >= 0 ? 'replace-same-proof-observation' : 'append-current-page-link-observation', manualAction: 'update-latest-page-link-proof', countEffect: 0 }, null, 2));
