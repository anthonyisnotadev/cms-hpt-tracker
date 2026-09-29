'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-baptist-beaumont-current-para-mrf-proof-2026-09-21.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const { csvToObjects } = require('./lib/util');
const compliance = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
const base = compliance.find(row => row.ccn === p.ccn);
if (!base) throw new Error(`Missing compliance row for ${p.ccn}`);
if (p.declared_license_state !== p.state || p.cms_template_version !== '3.0.0') throw new Error('Incomplete Baptist MRF proof');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const evidence = {
  identity: 'corroborated',
  identity_basis: 'current-first-party-price-transparency-link-and-complete-cms-csv-header-name-address-state-date-version',
  officialDomain: 'bhset.net',
  sourcePageUrl: p.pricing_tool_url,
  sourcePageSha256: p.pricing_tool_sha256,
  identityPageSha256: p.pricing_tool_sha256,
  pricingToolUrl: p.pricing_tool_url,
  pricingToolObservation: p.pricing_tool_browser_observation,
  pointerUrl: p.root_pointer_url,
  pointerIssue: 'root-pointer-http-error',
  pointerHttpStatus: p.root_pointer_http_status,
  pointerSha256: p.root_pointer_response_sha256,
  pointerResponseContentType: 'text/html; charset=UTF-8',
  pointerResponseBytes: p.root_pointer_response_bytes,
  url: p.page_linked_mrf_url,
  fileSha256: p.page_linked_mrf_sha256,
  http_status: p.page_linked_mrf_http_status,
  contentType: p.page_linked_mrf_content_type,
  contentDisposition: p.page_linked_mrf_content_disposition,
  completeFileBytes: p.page_linked_mrf_bytes,
  sampleBytes: p.bounded_sample_bytes,
  checked_at: p.observed_at,
  date: p.declared_last_updated,
  version: p.cms_template_version,
  location_name: p.declared_location_name,
  declared_hospital_name: p.declared_hospital_name,
  declared_address: p.declared_address,
  declared_license_state: p.declared_license_state,
  declared_license_number: p.declared_license_number,
  declared_npi: p.declared_npi,
  file_kind: 'csv',
  observedFinding: 'official-page-linked-current-shared-system-mrf-identity-confirmed-root-pointer-unavailable',
  rootPointerHttpStatus: p.root_pointer_http_status,
  rootPointerUnavailable: true
};
const entry = {
  ccn: p.ccn,
  base,
  action: 'replace',
  finding: 'compliant-observed',
  evidence,
  evidence_run: 'baptist-beaumont-current-para-mrf-2026-09-21',
  reviewed_at: p.observed_at,
  note: p.interpretation
};
const index = ledger.findIndex(row => row.ccn === p.ccn);
if (index >= 0) ledger[index] = entry; else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: p.ccn, finding: entry.finding, fileSha256: p.page_linked_mrf_sha256 }, null, 2));
