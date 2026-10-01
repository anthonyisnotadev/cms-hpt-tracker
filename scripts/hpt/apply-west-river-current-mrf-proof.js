'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects, parseCSV } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-west-river-regional-current-mrf-proof-2026-09-29.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const retained = path.join(root, proof.mrf.retained_file);
const bytes = fs.readFileSync(retained);
const hash = crypto.createHash('sha256').update(bytes).digest('hex');
if (bytes.length !== proof.mrf.bytes || hash !== proof.mrf.sha256) throw new Error('West River retained MRF hash mismatch');
const rows = parseCSV(bytes.toString('utf8'));
if (rows.length !== proof.mrf.parsed_data_rows + 3 || rows[2].length !== proof.mrf.columns
  || !rows.slice(3).every(row => row.length === proof.mrf.columns)) throw new Error('West River CSV shape changed');
const header = rows[2];
const data = rows.slice(3);
const filled = field => data.filter(row => row[header.indexOf(field)]?.trim()).length;
for (const [field, expected] of [
  ['standard_charge | gross', proof.mrf.data_rows_with_gross_charge],
  ['standard_charge | discounted_cash', proof.mrf.data_rows_with_discounted_cash_charge],
  ['payer_name', proof.mrf.data_rows_with_payer],
  ['standard_charge | negotiated_dollar', proof.mrf.data_rows_with_negotiated_dollar_charge],
]) if (filled(field) !== expected) throw new Error(`West River CSV ${field} count changed`);

const cmsPayload = JSON.parse(fs.readFileSync(path.join(root, 'tmp/cms-hospital-enrollments-may-2026-all.json'), 'utf8'));
const cmsRecord = cmsPayload.find(row => row.CCN === proof.ccn);
if (!cmsRecord || cmsRecord.NPI !== proof.cms_enrollment.record.NPI
  || cmsRecord['DOING BUSINESS AS NAME'] !== proof.cms_enrollment.record['DOING BUSINESS AS NAME'])
  throw new Error('West River CMS enrollment response changed');
proof.cms_enrollment.record = cmsRecord;

const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
if (!base) throw new Error('West River raw nationwide CCN is missing');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'current-first-party-page-linked-complete-mrf-exact-ccn-cms-enrollment-legal-name-dba-address-primary-npi',
  officialDomain: proof.official_domain,
  sourcePageUrl: proof.official_pricing_page,
  pointerUrl: proof.pointer.url,
  pointerSha256: proof.pointer.sha256,
  pointerMrfUrl: proof.pointer.declared_mrf_url,
  pointerMrfStatus: proof.pointer.declared_target_status,
  url: proof.mrf.url,
  finalUrl: proof.mrf.url,
  http_status: proof.mrf.status,
  checked_at: proof.observed_at,
  date: proof.mrf.declared_last_updated,
  version: proof.mrf.cms_template_version,
  declared_hospital_name: proof.mrf.declared_hospital_name,
  location_name: proof.mrf.declared_location_name,
  declared_address: proof.mrf.declared_address,
  declared_license_number: proof.mrf.declared_license_number,
  declared_license_state: proof.mrf.declared_license_state,
  declared_npi: proof.mrf.declared_npi_list.join('|'),
  primary_npi: proof.cms_enrollment.record.NPI,
  file_kind: 'csv',
  fileSha256: hash,
  fullFileBytes: bytes.length,
  retainedFile: proof.mrf.retained_file,
  parsedDataRows: proof.mrf.parsed_data_rows,
  attestationPresent: true,
  observedFinding: 'date-within-365-days-version-3',
  pointerIssue: 'cms-hpt.txt-declared-target-404-current-page-linked-file-verified',
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (ledger.some(row => row.ccn === proof.ccn)) throw new Error('Unexpected pre-existing West River reviewed resolution');
ledger.push({
  ccn: proof.ccn, base, action: 'replace', finding: 'verified-current-mrf', evidence,
  evidence_run: 'west-river-current-page-file-complete-ccn-enrollment-review-2026-09-29',
  reviewed_at: proof.observed_at,
  note: 'Current official WRHS pricing page publishes the complete CSV. Exact CCN 351330 CMS enrollment matches legal operator, DBA, address and the file-declared primary NPI. The current root pointer is separately retrievable but names a different target returning 404; preserve this pointer defect without conflating it with the current page-linked file. Full bytes and usable price fields are hash-bound. This is current MRF evidence, not a legal compliance determination.'
});
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
manual.records.push({
  ccn: proof.ccn, observed_at: proof.observed_at, proof_file: proofName,
  official_site: 'https://www.wrhs.com/', official_page_url: proof.official_pricing_page,
  pointer_url: proof.pointer.url, pointer_status: 200, pointer_sha256: proof.pointer.sha256,
  pointer_declared_mrf_url: proof.pointer.declared_mrf_url, pointer_mrf_status: 404,
  facility_file_url: proof.mrf.url, file_status: 200, file_range_status: 'complete-200',
  file_sample_bytes: proof.mrf.bytes, file_sample_sha256: proof.mrf.sha256,
  declared_hospital_name: proof.mrf.declared_hospital_name,
  declared_location_name: proof.mrf.declared_location_name,
  declared_address: proof.mrf.declared_address, declared_license_number: proof.mrf.declared_license_number,
  declared_license_state: proof.mrf.declared_license_state,
  declared_npi: proof.mrf.declared_npi_list.join('|'), declared_last_updated: proof.mrf.declared_last_updated,
  cms_template_version: proof.mrf.cms_template_version, attestation: true,
  cms_enrollment_npi: proof.cms_enrollment.record.NPI,
  manual_identity_gate: evidence.identity_basis, disposition: 'verified-current-mrf',
  next_action: proof.next_action, interpretation: proof.interpretation,
});
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn) || String(a.observed_at || '').localeCompare(String(b.observed_at || '')));
fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);

const browserPath = path.join(audit, 'nationwide-browser-reviews.json');
const browser = JSON.parse(fs.readFileSync(browserPath, 'utf8'));
browser.records.push({
  kind: 'official-page-file-full-mrf-retrieval', ccn: proof.ccn, target: proof.mrf.url,
  final_url: proof.mrf.url, status: 'current-page-file-full-bytes-retrieved',
  title: 'West River Regional Medical Center current price transparency CSV',
  detail: `The current official WRHS pricing page links this exact CSV. Full ${proof.mrf.bytes}-byte retrieval parses as ${proof.mrf.parsed_data_rows} consistent-width rows with gross, cash, payer and negotiated-dollar values. Exact CCN CMS enrollment matches the facility legal name, DBA, campus address and primary NPI. The current cms-hpt.txt is separately retrieved and hash-bound but names a different target returning 404.`,
  browser: 'Codex in-app browser plus bounded direct HTTP retrieval', http_status: 200,
  bytes_read: proof.mrf.bytes, identity: 'exact-current-ccn-enrollment-page-file-and-full-file-identity-corroborated',
  declared_hospital_name: proof.mrf.declared_hospital_name, declared_address: proof.mrf.declared_address,
  declared_license_state: proof.mrf.declared_license_state, declared_last_updated: proof.mrf.declared_last_updated,
  cms_template_version: proof.mrf.cms_template_version, observed_at: proof.observed_at,
  source_page_url: proof.official_pricing_page, pointer_url: proof.pointer.url, mrf_url: proof.mrf.url,
  file_sha256: proof.mrf.sha256, proof_file: proofName, next_action: proof.next_action,
});
browser.updated_at = proof.observed_at;
fs.writeFileSync(browserPath, `${JSON.stringify(browser, null, 2)}\n`);

const bytePath = path.join(audit, 'nationwide-file-byte-proof.json');
const byteProof = JSON.parse(fs.readFileSync(bytePath, 'utf8'));
byteProof.records.push({
  url: proof.mrf.url, ccns: [proof.ccn], checked_at: proof.observed_at, final_url: proof.mrf.url,
  http_status: 200, requested_range: 'complete-file', bytes_retained: bytes.length, sha256: hash,
  raw_artifact: proof.mrf.retained_file, content_type: proof.mrf.content_type,
  parsed_root_candidates: [{ fileKind: 'csv', innerKind: 'csv', declaredLastUpdated: proof.mrf.declared_last_updated,
    cmsVersion: proof.mrf.cms_template_version, mrfHospitalName: proof.mrf.declared_hospital_name,
    mrfLocationName: proof.mrf.declared_location_name, mrfAddress: proof.mrf.declared_address,
    mrfLicenseState: proof.mrf.declared_license_state }], error: '', final_host: 'hospitalpricetransparencyfiles.com',
});
byteProof.records.sort((a, b) => String(a.url).localeCompare(String(b.url)) || String(a.checked_at).localeCompare(String(b.checked_at)));
fs.writeFileSync(bytePath, `${JSON.stringify(byteProof, null, 2)}\n`);

console.log(JSON.stringify({ ccn: proof.ccn, finding: 'verified-current-mrf', bytes: bytes.length, sha256: hash,
  ledgerEntries: ledger.length, unresolvedToRecover: base.finding }, null, 2));
