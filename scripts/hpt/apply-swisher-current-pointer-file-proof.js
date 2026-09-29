'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-swisher-current-pointer-file-proof-2026-09-23.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const { csvToObjects } = require('./lib/util');
const compliance = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
const base = compliance.find(row => row.ccn === p.ccn);
if (!base) throw new Error(`Missing compliance row for ${p.ccn}`);
const bytes = fs.readFileSync('Z:/swisher-current.body');
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
if (bytes.length !== p.full_file_bytes || sha !== p.full_file_sha256) throw new Error('Swisher file proof mismatch');
if (p.declared_license_state !== 'TX' || p.cms_template_version !== '3.0.0') throw new Error('Incomplete Swisher MRF proof');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-root-pointer-current-portal-main-hospital-page-complete-csv-header-address-state-date-version-license-npi-cms-roster',
  officialDomain: p.official_domain,
  sourcePageUrl: p.official_pricing_page,
  sourcePageSha256: p.source_page_sha256,
  facilityPageUrl: p.facility_page_url,
  facilityPageSha256: p.facility_page_sha256,
  pointerUrl: p.pointer_url,
  pointerSha256: p.pointer_sha256,
  pointerResponseBytes: p.pointer_response_bytes,
  pointerMrfUrl: p.mrf_url,
  pointerDeclaredMrfUrl: p.pointer_declared_mrf_url,
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
  cmsRecord: { ccn: p.ccn, name: 'SWISHER MEMORIAL HOSPITAL', address: '539 SOUTHEAST 2ND', city: 'TULIA', state: 'TX', zip: '79088' },
  observedFinding: p.observed_finding,
  addressNote: 'The first-party main-hospital page identifies 539 S.E. 2nd Street as the hospital; the site footer separately identifies 105 Hospital Ave as the rural health clinic.'
};
const entry = {
  ccn: p.ccn,
  base,
  action: 'replace',
  finding: 'verified-current-mrf',
  evidence,
  evidence_run: 'swisher-current-pointer-file-complete-retrieval-2026-09-23',
  reviewed_at: p.observed_at,
  note: 'The Swisher root cms-hpt.txt identifies a facility-specific PARA CSV and the official site links the current portal. The complete CMS 3.0.0 CSV identifies the hospital at 539 S.E. 2nd Street, Tulia, TX 79088, with Texas license 100122, NPI, attestation and a 2026-06-17 date. The main-hospital page independently confirms that address; the separate 105 Hospital Ave clinic footer address is retained as a distinct location. This is observed evidence and not a legal compliance conclusion.'
};
const index = ledger.findIndex(row => row.ccn === p.ccn);
if (index >= 0) ledger[index] = entry; else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: p.ccn, finding: entry.finding, fileSha256: sha }, null, 2));
