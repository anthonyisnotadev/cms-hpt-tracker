'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-saint-joseph-joliet-current-file-proof-2026-09-19.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
if (!base || base.domain !== 'saintjosephmedicalcenter.com') throw new Error('Unexpected Saint Joseph base row');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const evidence = {
  identity: 'corroborated',
  identity_basis: 'exact-pointer-entry-pricing-page-link-complete-file-header-name-address-state-date-and-version',
  pointerUrl: proof.pointer_url,
  pointerSha256: proof.pointer_sha256,
  url: proof.mrf_url,
  fileSha256: proof.full_file_sha256,
  fullFileBytes: proof.full_file_bytes,
  http_status: proof.response_status,
  checked_at: proof.observed_at,
  date: proof.declared_last_updated,
  version: proof.cms_template_version,
  officialDomain: 'saintjosephmedicalcenter.com',
  location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_license_state,
  file_kind: 'json',
  sourcePageUrl: proof.identity_page,
  observedFinding: proof.observed_finding
};
const entry = {
  ccn: proof.ccn,
  base,
  action: 'replace',
  evidence,
  evidence_run: 'saint-joseph-joliet-current-pointer-page-file-2026-09-19',
  reviewed_at: proof.observed_at,
  note: 'The current Saint Joseph pointer and browser-rendered pricing page link the same complete JSON. Its header identifies Saint Joseph Medical Center - Joliet at 333 Madison Street, Joliet IL, with 2026-09-01 and version 3.0. The older crawl assignment is retained in history.'
};
const existing = ledger.find(row => row.ccn === proof.ccn);
if (existing && JSON.stringify(existing.evidence) !== JSON.stringify(evidence)) throw new Error('Existing Saint Joseph resolution differs');
if (!existing) ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
const observationsPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const observations = JSON.parse(fs.readFileSync(observationsPath, 'utf8'));
const observation = {
  ccn: proof.ccn,
  observed_at: proof.observed_at,
  proof_file: path.basename(path.join(audit, 'reconciliation-saint-joseph-joliet-current-file-proof-2026-09-19.json')),
  official_site: proof.official_site,
  official_pricing_page: proof.identity_page,
  pointer_url: proof.pointer_url,
  pointer_sha256: proof.pointer_sha256,
  pointer_mrf_url: proof.mrf_url,
  pointer_mrf_http_status: proof.response_status,
  pointer_mrf_full_file_bytes: proof.full_file_bytes,
  pointer_mrf_full_file_sha256: proof.full_file_sha256,
  pointer_mrf_sample_sha256: proof.sample_sha256,
  pointer_mrf_declared_name: proof.declared_hospital_name,
  pointer_mrf_declared_address: proof.declared_address,
  pointer_mrf_license_state: proof.declared_license_state,
  pointer_mrf_declared_date: proof.declared_last_updated,
  pointer_mrf_version: proof.cms_template_version,
  browser_page_link_observation: 'The rendered pricing page links the exact pointer file and displays Saint Joseph Medical Center at 333 Madison Street, Joliet, IL 60435.',
  disposition: 'identity-confirmed-current-file-recheck',
  next_action: 'Recheck after a publisher file or pointer change; retain the complete-file hash and exact page/pointer linkage.'
};
const oldObservation = observations.records.findIndex(row => row.ccn === proof.ccn);
if (oldObservation >= 0) observations.records[oldObservation] = { ...observations.records[oldObservation], latest_current_file_resolution: observation };
else observations.records.push(observation);
fs.writeFileSync(observationsPath, JSON.stringify(observations, null, 2) + '\n');
console.log(JSON.stringify({ applied: !existing, ccn: proof.ccn, finding: evidence.observedFinding }, null, 2));
