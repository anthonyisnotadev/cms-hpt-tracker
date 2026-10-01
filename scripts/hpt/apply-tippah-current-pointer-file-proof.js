'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('./lib/util');
const { sha } = require('./lib/recovery-transport');

const ROOT = path.resolve(__dirname, '../..');
const AUDIT = path.join(ROOT, 'data/hpt-audit');
const proofName = 'reconciliation-tippah-current-pointer-file-proof-2026-09-30.json';
const proof = JSON.parse(fs.readFileSync(path.join(AUDIT, proofName), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(AUDIT, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
if (!base || proof.ccn !== '251337' || base.hospital_name !== 'TIPPAH COUNTY HOSPITAL' || base.city !== 'RIPLEY' || base.state !== 'MS') throw new Error('Unexpected CCN roster row');
if (proof.pointer_status < 200 || proof.pointer_status >= 300 || proof.pointer_sha256 !== 'd819d1e69211dccf048359b4f325e7d60997052a917635427d465de2327f179b') throw new Error('Root pointer is not the retained hash-bound pointer');
if (proof.pointer_location_name !== 'Tippah County Hospital' || proof.pointer_source_page_url !== proof.source_page_url || proof.mrf_url !== 'https://secure.claraprice.net/price-transparency/OBKI-1787257626375/machine-readable/646001350_tippah-county-hospital_standardcharges.json') throw new Error('Pointer linkage mismatch');
if (proof.official_site_status !== 200 || proof.source_page_status !== 200 || proof.mrf_status !== 200 || proof.mrf_content_length !== proof.mrf_total_bytes || !proof.complete_file_retrieval || !proof.complete_json_parse) throw new Error('Incomplete source/file retrieval proof');
if (proof.declared_hospital_name !== 'Tippah County Hospital' || proof.declared_location_name !== 'Tippah County Hospital' || proof.declared_license_state !== 'MS' || proof.declared_license_number !== '11159' || proof.declared_npi !== '1730578600' || proof.declared_address !== '1005 City Avenue North, Ripley, MS 38663' || proof.declared_last_updated !== '2026-09-14' || proof.cms_template_version !== '3.0.0' || !proof.declared_attestation) throw new Error('Facility or CMS v3 metadata mismatch');
const rawPath = path.join(ROOT, proof.retained_file);
const raw = fs.readFileSync(rawPath);
if (raw.length !== proof.mrf_total_bytes || sha(raw) !== proof.mrf_sha256) throw new Error('Retained complete MRF does not reproduce recorded byte count and SHA-256');
const parsedFile = JSON.parse(raw.toString('utf8'));
if (parsedFile.hospital_name !== proof.declared_hospital_name || parsedFile.last_updated_on !== proof.declared_last_updated || parsedFile.version !== proof.cms_template_version) throw new Error('Retained file metadata no longer matches proof');

const ledgerPath = path.join(AUDIT, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const evidence = {
  identity: 'corroborated',
  identity_basis: 'first-party-homepage-link-current-root-pointer-complete-json-exact-name-address-ms-license-npi-and-version',
  officialDomain: proof.official_domain,
  officialSiteUrl: proof.official_site_url,
  officialSiteSha256: proof.official_site_sha256,
  sourcePageUrl: proof.source_page_url,
  sourcePageSha256: proof.source_page_sha256,
  pointerUrl: proof.pointer_url,
  pointerSha256: proof.pointer_sha256,
  pointerLocationName: proof.pointer_location_name,
  url: proof.mrf_url,
  finalUrl: proof.mrf_url,
  http_status: proof.mrf_status,
  checked_at: proof.observed_at,
  date: proof.declared_last_updated,
  version: proof.cms_template_version,
  declared_hospital_name: proof.declared_hospital_name,
  location_name: proof.declared_location_name,
  declared_address: proof.declared_address,
  declared_license_number: proof.declared_license_number,
  declared_license_state: proof.declared_license_state,
  declared_npi: proof.declared_npi,
  file_kind: 'json',
  fileSha256: proof.mrf_sha256,
  fullFileBytes: proof.mrf_total_bytes,
  completeFileRetrieved: true,
  completeJsonParsed: true,
  cmsValidatorRun: false,
  attestationPresent: true,
  observedFinding: 'date-within-365-days-version-3'
};
const evidenceHistory = [{
  evidence_run: 'prior-official-csv-observation-2026-09-06',
  reviewed_at: '2026-09-06T19:57:02.786Z',
  url: 'https://www.tippahcountyhospital.com/assets/Uploads/646001350_tippah-county-hospital_standardcharges.csv?vid=3',
  date: '2025-07-29',
  version: '2.0.0',
  http_status: 206,
  file_bytes: 23279473,
  note: 'Older official-site CSV observation remains in the historical crawl; it is distinct from the current pointer-declared JSON and is not substituted for current evidence.'
}];
const entry = {
  ccn: proof.ccn,
  base,
  action: 'replace',
  evidence_history: evidenceHistory,
  evidence,
  finding: 'verified-current-mrf',
  evidence_run: 'tippah-current-root-pointer-complete-json-v3-2026-09-30',
  reviewed_at: proof.observed_at,
  note: `The first-party Tippah County Hospital homepage links its Price Transparency page; the exact retained root pointer links that page and the complete JSON MRF. The ${proof.mrf_total_bytes}-byte file parses in full, hashes to ${proof.mrf_sha256}, and declares Tippah County Hospital at ${proof.declared_address}, Mississippi license ${proof.declared_license_number}, NPI ${proof.declared_npi}, updated ${proof.declared_last_updated}, CMS ${proof.cms_template_version}, with attestation. The older official CSV dated 2025-07-29/version 2.0.0 is retained as historical evidence, not treated as the current linked file. No CMS validator run, rate-line audit, or legal-compliance conclusion is claimed.`
};
const index = ledger.findIndex(row => row.ccn === proof.ccn);
if (index >= 0) ledger[index] = entry; else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');

const manualPath = path.join(AUDIT, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
manual.records = manual.records.filter(row => row.ccn !== proof.ccn);
manual.records.push({
  ccn: proof.ccn,
  observed_at: proof.observed_at,
  proof_file: proofName,
  official_site: proof.official_site_url,
  official_pricing_page: proof.source_page_url,
  pointer_url: proof.pointer_url,
  pointer_status: proof.pointer_status,
  pointer_bytes: proof.pointer_bytes,
  pointer_sha256: proof.pointer_sha256,
  facility_file_url: proof.mrf_url,
  file_status: proof.mrf_status,
  file_bytes: proof.mrf_total_bytes,
  file_sha256: proof.mrf_sha256,
  declared_hospital_name: proof.declared_hospital_name,
  declared_location_name: proof.declared_location_name,
  declared_address: proof.declared_address,
  declared_license_number: proof.declared_license_number,
  declared_license_state: proof.declared_license_state,
  declared_npi: proof.declared_npi,
  declared_last_updated: proof.declared_last_updated,
  cms_template_version: proof.cms_template_version,
  attestation: proof.declared_attestation,
  disposition: 'verified-current-mrf',
  manual_identity_gate: 'first-party-link-pointer-complete-file-name-address-license-npi-state-and-v3-agree',
  complete_file_retrieval: true,
  complete_json_parse: true,
  cms_validator_run: false,
  next_action: 'Recheck the first-party link, root pointer, full-file hash and declared metadata at the next scheduled source update; keep the older CSV only as historical evidence.'
});
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: proof.ccn, finding: entry.finding, retained_file_bytes: raw.length, mrf_sha256: proof.mrf_sha256 }, null, 2));
