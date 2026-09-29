'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-hamilton-stale-pointer-file-proof-2026-09-23.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const { csvToObjects } = require('./lib/util');
const compliance = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
const base = compliance.find(row => row.ccn === p.ccn);
if (!base) throw new Error(`Missing compliance row for ${p.ccn}`);
const bytes = fs.readFileSync('Z:/ham-mrf.body');
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
if (bytes.length !== p.full_file_bytes || sha !== p.full_file_sha256) throw new Error('Hamilton file proof mismatch');
if (p.declared_last_updated !== '2025-05-08' || p.declared_license_state !== 'TX') throw new Error('Incomplete Hamilton stale proof');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-root-pointer-clara-price-page-complete-json-header-address-state-stale-date-version-license-npi-cms-roster',
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
  declared_npi: p.declared_npi,
  file_kind: 'json',
  fileSha256: p.full_file_sha256,
  fullFileBytes: p.full_file_bytes,
  retainedSampleBytes: p.full_file_bytes,
  dataRows: p.data_rows,
  attestationPresent: p.attestation,
  attesterName: p.attester_name,
  observedFinding: p.observed_finding,
  cmsRecord: { ccn: p.ccn, name: 'HAMILTON HOSPITAL', address: '901 WEST HAMILTON', city: 'OLNEY', state: 'TX', zip: '76374' }
};
const entry = {
  ccn: p.ccn,
  base,
  action: 'replace-observation',
  finding: 'mrf-stale-over-365-days',
  evidence,
  evidence_run: 'hamilton-pointer-stale-file-observation-2026-09-23',
  reviewed_at: p.observed_at,
  note: 'The official Hamilton root cms-hpt.txt and ClaraPrice page identify the same facility-specific JSON. The complete CMS 3.0.0 file identifies Olney Hamilton Hospital at 901 West Hamilton, Olney, TX 76374, with Texas license 000294 and NPI, but is dated 2025-05-08, over 365 days old at observation. Retain as a stale observed file, not a current verification claim; recheck after publisher update.'
};
const index = ledger.findIndex(row => row.ccn === p.ccn);
if (index >= 0) ledger[index] = entry; else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: p.ccn, finding: entry.finding, fileSha256: sha }, null, 2));
