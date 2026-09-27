'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-richland-hospital-current-page-file-proof-2026-09-23.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find((r) => r.ccn === p.ccn) || {};
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-first-party-pricing-page-linked-hpi-file-bounded-header-address-state-date-version-npi-attestation-multi-location-scope-recorded',
  officialDomain: p.official_domain,
  sourcePageUrl: p.official_pricing_page,
  pointerUrl: p.official_pricing_page,
  pricingToolUrl: p.pricing_listing_url,
  pointerIssue: 'page-linked-third-party-host',
  pageObservedAt: p.observed_at,
  pageStatus: 200,
  pageAccessMethod: 'web-open',
  pointerMrfUrl: p.mrf_url,
  url: p.mrf_url,
  finalUrl: p.mrf_url,
  http_status: p.mrf_status,
  checked_at: p.observed_at,
  date: p.declared_last_updated,
  version: p.cms_template_version,
  declared_hospital_name: p.declared_hospital_name,
  location_name: p.declared_location_name,
  declared_address: p.declared_address,
  declared_license_number: p.declared_license_number,
  declared_license_state: p.declared_license_state,
  declared_npi: p.declared_npi,
  facility_address: p.cms_record.address,
  facility_state: p.cms_record.state,
  file_kind: 'csv',
  fullFileBytes: p.mrf_total_bytes,
  retainedSampleBytes: p.mrf_sample_bytes,
  sampleSha256: p.mrf_sample_sha256,
  contentMd5Base64: p.mrf_content_md5_base64,
  attestationPresent: p.declared_attestation,
  attesterName: p.declared_attester,
  cmsRecord: p.cms_record,
  observedFinding: 'official-page-third-party-mrf'
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const entry = { ccn: p.ccn, base, action: 'replace', finding: 'verified-current-mrf', evidence, evidence_run: 'richland-hospital-current-page-file-bounded-retrieval-2026-09-23', reviewed_at: p.observed_at, note: p.interpretation };
const index = ledger.findIndex((r) => r.ccn === p.ccn);
if (index >= 0) ledger[index] = entry; else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
manual.records = manual.records.filter((r) => r.ccn !== p.ccn);
manual.records.push({ ...p, proof_file: proofName, disposition: 'verified-current-page-file' });
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: p.ccn, finding: entry.finding, bytes: p.mrf_total_bytes }, null, 2));
