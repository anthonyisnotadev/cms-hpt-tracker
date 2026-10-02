'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-renown-290001-current-external-mrf-proof-2026-10-01.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === p.ccn);
if (!base) throw new Error(`Missing compliance row for ${p.ccn}`);
if (p.declared_license_state !== p.state || p.cms_template_version !== '3.0.0' || p.mrf_bytes < 1000000 || !p.attestation_present) throw new Error('Incomplete Renown Regional MRF proof');
if (p.declared_hospital_name !== 'Renown Regional Medical Center' || !/1155 Mill Street/.test(p.declared_address)) throw new Error('Renown identity mismatch in proof');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-first-party-pricing-page-publisher-download-complete-csv-header-exact-name-address-state-npi-date-version-license-attestation',
  officialDomain: 'renown.org',
  sourcePageUrl: p.official_pricing_page,
  sourcePageObservation: 'first-party pricing page observed 2026-09-19 listing the Regional CSV link and current-as-of 2026-03-27; this session the same page returned 429 to automation',
  pointerUrl: p.mrf_url,
  pointerSourcePageUrl: p.official_pricing_page,
  pointerIssue: 'official-linked-publisher-download-mrf; first-party-root-pointer-http-429',
  pointerHttpStatus: p.mrf_http_status,
  pointerSha256: p.mrf_sha256,
  pointerResponseBytes: p.mrf_bytes,
  pointerEntryCount: null,
  url: p.mrf_url,
  resolvedFileUrl: p.mrf_redirect_url,
  fileSha256: p.mrf_sha256,
  fullFileBytes: p.mrf_bytes,
  http_status: p.mrf_http_status,
  contentType: p.mrf_content_type,
  checked_at: p.observed_at,
  date: p.declared_last_updated,
  version: p.cms_template_version,
  location_name: p.declared_location_name,
  declared_hospital_name: p.declared_hospital_name,
  declared_address: p.declared_address,
  declared_license_state: p.declared_license_state,
  declared_license_number: p.declared_license_number,
  npi: p.declared_npi,
  attestation_present: p.attestation_present,
  file_kind: 'csv',
  observedFinding: p.disposition,
  rootPointerUnavailable: true,
  firstPartyRootPointerUrl: p.root_pointer_url,
  firstPartyRootPointerHttpStatus: p.root_pointer_http_status,
  firstPartyRootPointerResponseSha256: p.root_pointer_response_sha256
};
const entry = {
  ccn: p.ccn,
  base,
  action: 'replace',
  finding: 'compliant-observed',
  evidence,
  evidence_run: 'renown-290001-current-external-mrf-2026-10-01',
  reviewed_at: p.observed_at,
  note: p.interpretation
};
const next = ledger.filter(row => row.ccn !== p.ccn);
next.push(entry);
next.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(next, null, 2)}\n`);
console.log(JSON.stringify({ applied: p.ccn, finding: entry.finding, fileSha256: p.mrf_sha256 }, null, 2));
