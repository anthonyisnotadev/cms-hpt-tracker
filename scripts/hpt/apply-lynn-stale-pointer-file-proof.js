'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-lynn-stale-pointer-file-proof-2026-09-23.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const { csvToObjects } = require('./lib/util');
const compliance = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
const base = compliance.find(row => row.ccn === p.ccn);
if (!base) throw new Error(`Missing compliance row for ${p.ccn}`);
const bytes = fs.readFileSync('Z:/lynn-mrf.body');
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
if (bytes.length !== p.full_file_bytes || sha !== p.full_file_sha256) throw new Error('Lynn file proof mismatch');
if (p.cms_template_version !== '2.0.0' || p.declared_license_state !== 'TX') throw new Error('Incomplete Lynn stale proof');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-root-pointer-boomi-portal-complete-csv-header-address-state-stale-date-template-cms-roster',
  officialDomain: p.official_domain,
  sourcePageUrl: p.official_pricing_page,
  sourcePageSha256: p.source_page_sha256,
  pointerUrl: p.pointer_url,
  pointerSha256: p.pointer_sha256,
  pointerResponseBytes: p.pointer_response_bytes,
  pointerMrfUrl: p.mrf_url,
  url: p.mrf_url,
  http_status: p.response_status,
  checked_at: p.observed_at,
  date: p.declared_last_updated,
  version: p.cms_template_version,
  declared_hospital_name: p.declared_hospital_name,
  location_name: p.declared_location_name,
  declared_address: p.declared_address,
  facility_address: p.declared_address,
  declared_license_state: p.declared_license_state,
  declared_license_number: p.declared_license_number,
  file_kind: 'csv',
  fileSha256: p.full_file_sha256,
  fullFileBytes: p.full_file_bytes,
  retainedSampleBytes: p.full_file_bytes,
  dataRows: p.data_rows,
  attestationPresent: p.attestation,
  observedFinding: p.observed_finding,
  cmsRecord: { ccn: p.ccn, name: 'LYNN COUNTY HOSPITAL DISTRICT', address: '2600 LOCKWOOD STREET', city: 'TAHOKA', state: 'TX', zip: '79373' }
};
const entry = {
  ccn: p.ccn,
  base,
  action: 'replace-observation',
  finding: 'mrf-stale-over-365-days',
  evidence,
  evidence_run: 'lynn-pointer-stale-file-observation-2026-09-23',
  reviewed_at: p.observed_at,
  note: 'The official Lynn County root cms-hpt.txt names a facility-specific Box CSV and the official Boomi price-transparency portal. The complete file identifies Lynn County Hospital at 2600 Lockwood Street, Tahoka, TX 79373, but is dated 2025-02-01 and declares CMS template 2.0.0, over 365 days old at observation. This is retained as a stale observed file, not a current verification claim; recheck after publisher update.'
};
const index = ledger.findIndex(row => row.ccn === p.ccn);
if (index >= 0) ledger[index] = entry; else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: p.ccn, finding: entry.finding, fileSha256: sha }, null, 2));
