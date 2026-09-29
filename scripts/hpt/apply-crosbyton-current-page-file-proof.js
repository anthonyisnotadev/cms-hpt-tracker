'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-crosbyton-current-page-file-proof-2026-09-21.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
if (!base) throw new Error(`Missing Crosbyton base row ${proof.ccn}`);
if (base.state !== proof.state || proof.declared_license_state !== proof.state || proof.full_file_bytes < 1000000 || proof.cms_template_version !== '3.0.0') throw new Error('Incomplete Crosbyton proof');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-root-pointer-and-complete-page-linked-json-exact-name-address-state-npi-and-attestation',
  sourcePageUrl: proof.official_pricing_page,
  sourcePageSha256: proof.official_page_sha256,
  pointerUrl: proof.pointer_url,
  pointerSha256: proof.pointer_sha256,
  url: proof.mrf_url,
  fileSha256: proof.mrf_sha256,
  fullFileBytes: proof.full_file_bytes,
  http_status: proof.mrf_http_status,
  checked_at: proof.observed_at,
  date: proof.declared_last_updated,
  version: proof.cms_template_version,
  officialDomain: base.domain,
  location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_license_state,
  npi: proof.npi,
  attestation_present: proof.attestation_present,
  file_kind: 'json',
  observedFinding: proof.observed_finding
};
const entry = {
  ccn: proof.ccn,
  base,
  action: 'replace',
  finding: 'verified-current-mrf',
  evidence,
  evidence_run: 'crosbyton-current-root-pointer-page-file-review-2026-09-21',
  reviewed_at: proof.observed_at,
  note: 'The official Crosbyton root pointer links a complete ClaraPrice CMS 3.0.0 JSON file whose header exactly identifies Crosbyton Clinic Hospital at 710 West Main Street, Crosbyton TX 79322, with Texas license state, NPI 1063500270 and attestation. The file declares 2025-10-01, which is within 365 days of the 2026-09-21 review, so it is recorded as current pointer-linked evidence; no legal compliance conclusion is inferred.'
};
const next = ledger.filter(row => row.ccn !== proof.ccn);
next.push(entry);
next.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(next, null, 2)}\n`);
console.log(JSON.stringify({ applied: proof.ccn, finding: entry.finding }, null, 2));
