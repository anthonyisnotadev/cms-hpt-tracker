'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-parkview-regional-current-page-file-proof-2026-09-22.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find((r) => r.ccn === p.ccn) || {};
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-first-party-pricing-page-complete-current-json-name-address-state-date-version-npi-attestation',
  officialDomain: 'parkviewregional.com',
  sourcePageUrl: p.official_pricing_page,
  pointerUrl: p.pointer_url,
  pointerIssue: 'root-pointer-http-error',
  pointerHttpStatus: p.pointer_status,
  pointerResponseBytes: p.pointer_response_bytes,
  pointerSha256: p.pointer_sha256,
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
  facility_address: p.declared_address,
  facility_state: p.declared_license_state,
  file_kind: 'json',
  fileSha256: p.mrf_sha256,
  fullFileBytes: p.mrf_total_bytes,
  retainedSampleBytes: p.mrf_total_bytes,
  attestationPresent: p.declared_attestation,
  attesterName: p.declared_attester,
  observedFinding: 'official-page-mrf-root-pointer-unavailable'
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const entry = {
  ccn: p.ccn,
  base,
  action: 'replace',
  finding: 'verified-current-mrf',
  evidence,
  evidence_run: 'parkview-regional-current-page-file-complete-retrieval-2026-09-22',
  reviewed_at: p.observed_at,
  note: 'The official Parkview Regional pricing page links a complete current CMS 3.0.0 JSON matching the Mexia, Texas facility, address, license, NPI, attestation and 2026-04-01 date. The root pointer returned HTTP 406 with a recorded response hash; this is page-linked evidence and not a legal compliance conclusion.'
};
const index = ledger.findIndex((r) => r.ccn === p.ccn);
if (index >= 0) ledger[index] = entry; else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
manual.records = manual.records.filter((r) => r.ccn !== p.ccn);
manual.records.push({ ...p, proof_file: proofName, disposition: 'verified-current-page-file-root-pointer-unresolved' });
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: p.ccn, finding: entry.finding, bytes: p.mrf_total_bytes }, null, 2));
