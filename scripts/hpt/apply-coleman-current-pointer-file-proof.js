'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-coleman-current-pointer-file-proof-2026-09-23.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const { csvToObjects } = require('./lib/util');
const compliance = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
const base = compliance.find(row => row.ccn === p.ccn);
if (!base) throw new Error(`Missing compliance row for ${p.ccn}`);
const bytes = fs.readFileSync('Z:/coleman-mrf.body');
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
if (bytes.length !== p.full_file_bytes || sha !== p.full_file_sha256) throw new Error('Coleman file proof mismatch');
if (p.declared_license_state !== 'TX' || p.cms_template_version !== '3.0.0') throw new Error('Incomplete Coleman MRF proof');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-root-pointer-and-first-party-pricing-page-complete-csv-header-address-state-date-version-license-npi-cms-roster',
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
  file_kind: 'csv',
  fileSha256: p.full_file_sha256,
  fullFileBytes: p.full_file_bytes,
  retainedSampleBytes: p.full_file_bytes,
  dataRows: p.data_rows,
  attestationPresent: p.attestation,
  attesterName: p.attester_name,
  cmsRecord: { ccn: p.ccn, name: 'COLEMAN COUNTY MEDICAL CENTER COMPANY', address: '310 SOUTH PECOS STREET', city: 'COLEMAN', state: 'TX', zip: '76834' },
  observedFinding: p.observed_finding
};
const entry = {
  ccn: p.ccn,
  base,
  action: 'replace',
  finding: 'verified-current-mrf',
  evidence,
  evidence_run: 'coleman-current-pointer-file-complete-retrieval-2026-09-23',
  reviewed_at: p.observed_at,
  note: 'The official Coleman County Medical Center root cms-hpt.txt and pricing page identify the same facility-specific CSV. The complete CMS 3.0.0 CSV identifies Coleman County Medical Center at 310 South Pecos, Coleman, TX 76834, with Texas license 100168, NPIs, attestation and a 2026-02-10 date; the publisher name variant is retained. This is observed evidence and not a legal compliance conclusion.'
};
const index = ledger.findIndex(row => row.ccn === p.ccn);
if (index >= 0) ledger[index] = entry; else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: p.ccn, finding: entry.finding, fileSha256: sha }, null, 2));
