'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-culberson-current-page-file-proof-2026-09-23.json';
const p = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const { csvToObjects } = require('./lib/util');
const compliance = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
const base = compliance.find(row => row.ccn === p.ccn);
if (!base) throw new Error(`Missing compliance row for ${p.ccn}`);
const file = 'Z:/tmp-culberson.csv';
const bytes = fs.readFileSync(file);
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
if (bytes.length !== p.full_file_bytes || sha !== p.full_file_sha256) throw new Error('Culberson file proof mismatch');
if (p.declared_license_state !== 'TX' || p.cms_template_version !== '3.0.0') throw new Error('Incomplete Culberson MRF proof');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const evidence = {
  identity: 'corroborated',
  identity_basis: 'current-first-party-pricing-page-complete-csv-header-location-address-state-date-version-license-npi-cms-roster',
  officialDomain: p.official_domain,
  sourcePageUrl: p.source_page_url,
  sourcePageSha256: p.source_page_sha256,
  pointerUrl: p.pointer_url,
  pointerIssue: p.pointer_issue,
  pointerHttpStatus: p.pointer_http_status,
  pointerSha256: p.pointer_sha256,
  pointerResponseBytes: p.pointer_response_bytes,
  pointerBrowserObservation: p.pointer_browser_observation,
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
  cmsRecord: { ccn: p.ccn, name: 'CULBERSON HOSPITAL', address: 'EISENHOWER ROAD AND FM 2185', city: 'VAN HORN', state: 'TX', zip: '79855' },
  observedFinding: p.observed_finding,
  rootPointerUnavailable: false
};
const entry = {
  ccn: p.ccn,
  base,
  action: 'replace',
  finding: 'verified-current-mrf',
  evidence,
  evidence_run: 'culberson-current-page-file-curl-pointer-2026-09-23',
  reviewed_at: p.observed_at,
  note: 'The official Culberson Hospital pricing page and root cms-hpt.txt both identify the same complete CMS 3.0.0 CSV. Its header identifies Culberson Hospital at 800 Eisenhower Road, Van Horn, TX 79855, with Texas license, NPI, attestation and a 2026-02-10 date; the publisher name variant is retained. PowerShell and browser transport were blocked, but a bounded curl retrieval reproduced the root pointer and file. This is observed evidence and not a legal compliance conclusion.'
};
const index = ledger.findIndex(row => row.ccn === p.ccn);
if (index >= 0) ledger[index] = entry; else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: p.ccn, finding: entry.finding, fileSha256: sha }, null, 2));
