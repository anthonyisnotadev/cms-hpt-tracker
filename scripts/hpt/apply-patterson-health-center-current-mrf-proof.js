'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-patterson-health-center-current-mrf-proof-2026-09-29.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const source = path.join(audit, proof.mrf.retained_file);
const bytes = fs.readFileSync(source);
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
if (bytes.length !== proof.mrf.bytes || hash !== proof.mrf.sha256) {
  throw new Error(`Retained Patterson MRF mismatch: ${bytes.length} bytes / ${hash}`);
}
const compliance = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
const base = compliance.find(row => row.ccn === proof.ccn);
if (!base || base.finding !== 'not-assessed-domain-unknown') throw new Error('Patterson base row changed; review manually');

const resolutionEvidence = {
  identity: 'corroborated',
  identity_basis: 'exact-current-root-pointer-current-cms-ccn-nppes-npi-full-file-header-name-address-license-state-date-version-attestation-and-usable-rows',
  officialDomain: proof.official_domain,
  sourcePageUrl: proof.official_source_page.url,
  pointerUrl: proof.official_root_pointer.url,
  pointerSha256: proof.official_root_pointer.response_sha256,
  pointerLocationName: proof.official_root_pointer.parsed_location_name,
  url: proof.mrf.url,
  finalUrl: proof.mrf.final_url,
  http_status: proof.mrf.status,
  checked_at: proof.observed_at,
  date: proof.mrf.declared_last_updated,
  version: proof.mrf.cms_template_version,
  declared_hospital_name: proof.mrf.declared_hospital_name,
  location_name: proof.mrf.declared_location_name,
  declared_address: proof.mrf.declared_address,
  declared_license_number: proof.mrf.declared_license_number,
  declared_license_state: proof.mrf.declared_license_state,
  declared_npi: proof.mrf.declared_npi,
  file_kind: proof.mrf.file_kind,
  fileSha256: proof.mrf.sha256,
  fullFileBytes: proof.mrf.bytes,
  retainedFile: proof.mrf.retained_file,
  parsedDataRows: proof.mrf.parsed_data_rows,
  attestationPresent: proof.mrf.declared_attestation,
  observedFinding: 'date-within-365-days-version-3'
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old) throw new Error('Unexpected pre-existing Patterson reviewed resolution; reconcile it explicitly');
ledger.push({
  ccn: proof.ccn,
  base,
  action: 'replace',
  finding: 'verified-current-mrf',
  evidence: resolutionEvidence,
  evidence_run: 'patterson-health-center-current-pointer-file-complete-review-2026-09-29',
  reviewed_at: proof.observed_at,
  note: 'The current Patterson first-party cms-hpt.txt names the exact PARA report URL. Correctly using its dbAMCANTHONYKS report key retrieves the complete CMS 3.0.0 CSV. File metadata and all pricing rows are retained and hash-bound; current exact-CCN CMS identity and CMS NPI Registry name/address corroborate the campus. This is verified current MRF evidence, not a legal compliance determination.'
});
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
manual.records.push({
  ccn: proof.ccn,
  observed_at: proof.observed_at,
  proof_file: proofName,
  official_site: 'https://pattersonhc.org/',
  official_page_url: proof.official_source_page.url,
  pricing_tool_url: proof.publisher_pricing_page.url,
  pointer_url: proof.official_root_pointer.url,
  pointer_status: proof.official_root_pointer.status,
  pointer_bytes: proof.official_root_pointer.response_bytes,
  pointer_sha256: proof.official_root_pointer.response_sha256,
  pointer_location_name: proof.official_root_pointer.parsed_location_name,
  pointer_source_page_url: proof.official_root_pointer.parsed_source_page_url,
  facility_file_url: proof.mrf.url,
  file_status: proof.mrf.status,
  file_sample_bytes: proof.mrf.bytes,
  file_sample_sha256: proof.mrf.sha256,
  file_range_status: 'complete-200',
  declared_hospital_name: proof.mrf.declared_hospital_name,
  declared_location_name: proof.mrf.declared_location_name,
  declared_address: proof.mrf.declared_address,
  declared_license_number: proof.mrf.declared_license_number,
  declared_license_state: proof.mrf.declared_license_state,
  declared_npi: proof.mrf.declared_npi,
  declared_last_updated: proof.mrf.declared_last_updated,
  cms_template_version: proof.mrf.cms_template_version,
  attestation: proof.mrf.declared_attestation,
  manual_identity_gate: 'exact-current-ccn-cms-nppes-npi-pointer-and-full-file-name-address-state-date-version-attestation',
  disposition: 'verified-current-mrf',
  next_action: proof.next_action,
  interpretation: proof.interpretation
});
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn)
  || String(a.observed_at || '').localeCompare(String(b.observed_at || '')));
fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);

const browserPath = path.join(audit, 'nationwide-browser-reviews.json');
const browser = JSON.parse(fs.readFileSync(browserPath, 'utf8'));
browser.records.push({
  kind: 'official-pointer-full-mrf-retrieval',
  ccn: proof.ccn,
  target: proof.official_root_pointer.url,
  final_url: proof.official_root_pointer.url,
  status: 'current-pointer-and-exact-declared-file-retrieved',
  title: 'Patterson Health Center current price transparency file',
  detail: 'Browser inspection confirmed the Patterson-named PARA pricing page and its February 10, 2026 file label. The first-party CMS pointer was then fetched directly (200; 283 bytes; hash-bound) and names this exact PARA CSV. Earlier report-endpoint 500 used dbName=hospital; the current page JavaScript maps its control to dbAMCANTHONYKS. The correctly keyed URL returned and the complete 8,536,635-byte CSV was retained and parsed: CMS 3.0.0 / 2026-02-10, 26,408 pricing rows, exact Patterson legal name, 485 KS-2 Hwy 2 Anthony KS 67003, Kansas license field, NPI and attestation. Current CMS exact-CCN and NPI Registry records corroborate the address/name/NPI. No legal compliance determination is made.',
  browser: 'Codex In-app Browser plus bounded direct HTTP retrieval',
  http_status: 200,
  bytes_read: proof.official_root_pointer.response_bytes,
  identity: 'exact-current-ccn-pointer-npi-and-full-file-identity-corroborated',
  declared_hospital_name: proof.mrf.declared_hospital_name,
  declared_location_name: proof.mrf.declared_location_name,
  declared_address: proof.mrf.declared_address,
  declared_license_state: proof.mrf.declared_license_state,
  declared_last_updated: proof.mrf.declared_last_updated,
  cms_template_version: proof.mrf.cms_template_version,
  observed_at: proof.observed_at,
  source_page_url: proof.publisher_pricing_page.url,
  pointer_url: proof.official_root_pointer.url,
  mrf_url: proof.mrf.url,
  file_sha256: proof.mrf.sha256,
  proof_file: proofName,
  next_action: proof.next_action
});
browser.updated_at = proof.observed_at;
fs.writeFileSync(browserPath, `${JSON.stringify(browser, null, 2)}\n`);

const bytePath = path.join(audit, 'nationwide-file-byte-proof.json');
const byteProof = JSON.parse(fs.readFileSync(bytePath, 'utf8'));
byteProof.records.push({
  url: proof.mrf.url,
  ccns: [proof.ccn],
  checked_at: proof.observed_at,
  final_url: proof.mrf.final_url,
  http_status: proof.mrf.status,
  requested_range: 'complete-file',
  bytes_retained: proof.mrf.bytes,
  sha256: proof.mrf.sha256,
  raw_artifact: `data/hpt-audit/${proof.mrf.retained_file}`,
  content_type: proof.mrf.content_type,
  parsed_root_candidates: [{
    fileKind: 'csv', innerKind: 'csv', declaredLastUpdated: proof.mrf.declared_last_updated,
    cmsVersion: proof.mrf.cms_template_version, mrfHospitalName: proof.mrf.declared_hospital_name,
    mrfLocationName: proof.mrf.declared_location_name, mrfAddress: proof.mrf.declared_address,
    mrfLicenseState: proof.mrf.declared_license_state
  }],
  error: '',
  final_host: 'apps.para-hcfs.com'
});
byteProof.records.sort((a, b) => String(a.url).localeCompare(String(b.url))
  || String(a.checked_at).localeCompare(String(b.checked_at)));
fs.writeFileSync(bytePath, `${JSON.stringify(byteProof, null, 2)}\n`);

console.log(JSON.stringify({
  ccn: proof.ccn,
  finding: 'verified-current-mrf',
  bytes: bytes.length,
  sha256: hash,
  ledgerEntries: ledger.length,
  manualObservationsForCcn: manual.records.filter(row => row.ccn === proof.ccn).length,
  byteProofCcns: byteProof.records.filter(row => (row.ccns || []).includes(proof.ccn)).length
}, null, 2));
