'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-stamford-reviewed-pointer-alias-resolution-2026-09-20.json'), 'utf8'));
const { csvToObjects } = require('./lib/util');
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (!base || base.finding !== 'not-assessed-domain-unknown') throw new Error('Unexpected Stamford base row');
if (!/^[a-f0-9]{64}$/.test(proof.pointer_sha256) || !/^[a-f0-9]{64}$/.test(proof.file_sha256) || proof.full_file_bytes < 65536) throw new Error('Incomplete Stamford proof');
if (ledger.some(row => row.ccn === proof.ccn)) throw new Error('Stamford resolution already exists');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'exact-current-pointer-source-page-first-party-alias-complete-file-name-address-state-date-version',
  officialDomain: proof.official_domain,
  sourcePageUrl: proof.official_pricing_page,
  identityPageUrl: proof.identity_page,
  pointerUrl: proof.pointer_url,
  pointerSha256: proof.pointer_sha256,
  pointerMrfUrl: proof.pointer_mrf_url,
  pointerMrfHttpStatus: proof.pointer_mrf_http_status,
  pointerIssue: proof.pointer_issue,
  url: proof.alias_url,
  finalUrl: proof.alias_url,
  fileSha256: proof.file_sha256,
  fullFileBytes: proof.full_file_bytes,
  http_status: proof.alias_http_status,
  checked_at: proof.observed_at,
  date: proof.declared_date,
  version: proof.version,
  file_kind: proof.file_kind,
  location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address,
  facility_address: proof.declared_address,
  declared_license_state: proof.declared_license_state,
  facility_state: 'CT',
  observedFinding: proof.observed_finding,
  next_action: proof.next_action
};
const entry = {
  ccn: proof.ccn,
  base,
  action: 'replace-observation',
  evidence,
  evidence_run: 'stamford-pointer-alias-resolution-2026-09-20',
  reviewed_at: proof.observed_at,
  note: 'The current first-party Stamford Health pointer is readable and declares the exact current machine-readable file path and pricing page. The canonical www file route returns HTTP 403, while the first-party Dataweavers alias yields the complete 29,723,270-byte CSV. Its header identifies Stamford Hospital at One Hospital Plaza, Stamford CT, dated 2026-04-01 on CMS 3.0.0. The alias is recorded as an indirect first-party retrieval; direct canonical file access remains an explicit transport follow-up and no legal compliance conclusion is inferred.'
};
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, action: entry.action, observedFinding: evidence.observedFinding }, null, 2));
