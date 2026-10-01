'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-buchanan-general-current-pointer-proof-2026-09-30.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const raw = item => path.resolve(root, item.raw_artifact);
const pointerBytes = fs.readFileSync(raw(proof.sources.pointer));
const mrfBytes = fs.readFileSync(raw(proof.sources.current_mrf));
if (proof.ccn !== '490127'
    || pointerBytes.length !== proof.sources.pointer.bytes
    || sha256(pointerBytes) !== proof.sources.pointer.sha256
    || mrfBytes.length !== proof.sources.current_mrf.bytes
    || sha256(mrfBytes) !== proof.sources.current_mrf.sha256
    || proof.structure.cms_validator?.result !== 'valid'
    || proof.structure.cms_validator?.dictionary_version !== '3.0.0'
    || proof.structure.cms_validator?.errors !== 0
    || proof.structure.cms_validator?.alerts !== 0
    || proof.identity_review.file_name_agrees !== true
    || proof.identity_review.file_location_agrees !== true
    || proof.identity_review.file_address_agrees !== true
    || proof.identity_review.file_state_agrees !== true
    || proof.structure.data_rows !== proof.structure.rows_with_description
    || proof.structure.data_rows !== proof.structure.rows_with_gross_charge
    || proof.structure.data_rows !== proof.structure.rows_with_payer
    || proof.structure.row_widths.join(',') !== String(proof.structure.csv_header_columns))
  throw new Error('Buchanan current pointer/MRF evidence no longer passes byte, identity, structure and CMS v3 gates');

const compliance = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
const row = compliance.find(item => item.ccn === proof.ccn);
if (!row || row.domain !== 'bgh.org' || row.pointer_url !== 'https://bgh.org/cms-hpt.txt'
    || row.mrf_url !== proof.sources.prior_target.url)
  throw new Error('Buchanan base row changed; re-review before applying the current source evidence');
const base = Object.fromEntries([
  'ccn', 'hospital_name', 'city', 'state', 'type', 'finding', 'assessable', 'evidence', 'domain',
  'pointer_url', 'mrf_url', 'mrf_last_updated', 'mrf_days_since_update', 'cms_template_version', 'checked_at'
].map(key => [key, row[key] || '']));

const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const entry = {
  ccn: proof.ccn,
  base,
  action: 'replace',
  finding: 'verified-current-mrf',
  evidence: {
    identity: 'corroborated',
    identity_basis: 'current-first-party-root-pointer-exact-full-mrf-cms-v3-validation-facility-name-address-state-npi-and-usable-rows',
    officialDomain: 'bgh.org',
    sourcePageUrl: proof.sources.official_pricing_page.url,
    pointerUrl: proof.sources.pointer.final_url,
    pointerSha256: proof.sources.pointer.sha256,
    pointerLocationName: proof.identity_review.pointer_location_name,
    pointerMrfUrl: proof.sources.current_mrf.url,
    pointerHttpStatus: proof.sources.pointer.http_status,
    pointerResponseBytes: proof.sources.pointer.bytes,
    officialPricingPageUrl: proof.sources.official_pricing_page.url,
    url: proof.sources.current_mrf.url,
    finalUrl: proof.sources.current_mrf.final_url,
    http_status: proof.sources.current_mrf.http_status,
    checked_at: proof.structure.cms_validator.checked_at,
    date: '2026-09-02',
    declaredDateRaw: proof.sources.current_mrf.last_updated_on,
    version: proof.sources.current_mrf.version,
    declared_hospital_name: proof.sources.current_mrf.hospital_name,
    location_name: proof.sources.current_mrf.location_name,
    declared_address: proof.sources.current_mrf.hospital_address,
    declared_license_number: proof.sources.current_mrf['license_number|VA'],
    declared_license_state: 'VA',
    declared_npi: proof.sources.current_mrf.type_2_npi,
    file_kind: 'csv',
    fileSha256: proof.sources.current_mrf.sha256,
    fullFileBytes: proof.sources.current_mrf.bytes,
    parsedDataRows: proof.structure.data_rows,
    headerColumns: proof.structure.csv_header_columns,
    dataRowWidths: proof.structure.row_widths,
    rowsWithDescription: proof.structure.rows_with_description,
    rowsWithGrossCharge: proof.structure.rows_with_gross_charge,
    rowsWithPayer: proof.structure.rows_with_payer,
    rowsWithNegotiatedDollar: proof.structure.rows_with_negotiated_dollar,
    attestationPresent: proof.sources.current_mrf.attestation === 'TRUE',
    attesterNamePresent: !!proof.sources.current_mrf.attester_name,
    cmsValidator: proof.structure.cms_validator,
    observedFinding: 'date-within-365-days-version-3',
    previousPointerTarget: proof.sources.prior_target.url,
    previousPointerTargetHttpStatus: proof.sources.prior_target.observed_http_status
  },
  evidence_run: 'buchanan-general-current-pointer-full-v3-mrf-2026-09-30',
  reviewed_at: proof.structure.cms_validator.checked_at,
  note: 'The retained first-party root-pointer bytes declare the exact current CSV URL. The prior manifest URL omitted an underscore and returned 404; the pointer target returns the complete 2026-09-02 CMS 3.0.0 file. Full-file bytes/hash, facility name/address/VA license-state/NPI, attestation, 6,435 usable rows, and CMS v3.0 validator output (0 errors/0 alerts) support the current-MRF finding. The old target remains in the base snapshot/history.'
};
const prior = ledger.find(item => item.ccn === proof.ccn);
if (prior) throw new Error('Unexpected existing Buchanan resolution; reconcile explicitly');
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
if (manual.records.some(record => record.ccn === proof.ccn && record.proof_file === proofName))
  throw new Error('Buchanan manual observation already exists; reconcile explicitly');
manual.records.push({
  ccn: proof.ccn,
  observed_at: proof.structure.cms_validator.checked_at,
  proof_file: proofName,
  official_site: 'https://www.bgh.org/',
  official_pricing_page: proof.sources.official_pricing_page.url,
  pointer_url: proof.sources.pointer.final_url,
  pointer_status: 200,
  pointer_bytes: proof.sources.pointer.bytes,
  pointer_sha256: proof.sources.pointer.sha256,
  pointer_location_name: proof.identity_review.pointer_location_name,
  pointer_source_page_url: proof.sources.official_pricing_page.url,
  facility_file_url: proof.sources.current_mrf.url,
  file_status: 200,
  facility_file_status: 200,
  file_content_type: proof.sources.current_mrf.content_type,
  file_bytes: proof.sources.current_mrf.bytes,
  file_sha256: proof.sources.current_mrf.sha256,
  file_range_status: 200,
  file_retrieval_scope: 'complete-file-retrieved-and-hash-bound',
  full_file_validated: true,
  full_file_bytes: proof.sources.current_mrf.bytes,
  full_file_sha256: proof.sources.current_mrf.sha256,
  declared_hospital_name: proof.sources.current_mrf.hospital_name,
  declared_location_name: proof.sources.current_mrf.location_name,
  declared_address: proof.sources.current_mrf.hospital_address,
  declared_license_number: proof.sources.current_mrf['license_number|VA'],
  declared_license_state: 'VA',
  declared_npi: proof.sources.current_mrf.type_2_npi,
  declared_last_updated: '2026-09-02',
  cms_template_version: '3.0.0',
  attestation: true,
  parsed_data_rows: proof.structure.data_rows,
  data_rows_with_description: proof.structure.rows_with_description,
  data_rows_with_gross_charge: proof.structure.rows_with_gross_charge,
  data_rows_with_payer: proof.structure.rows_with_payer,
  data_rows_with_negotiated_dollar: proof.structure.rows_with_negotiated_dollar,
  csv_header_columns: proof.structure.csv_header_columns,
  csv_data_row_widths: proof.structure.row_widths,
  disposition: 'verified-current-mrf',
  manual_identity_gate: 'recorded-file-name-street-state-date-template-attestation-agree',
  next_action: 'Recheck through the next scheduled crawl; investigate again only if the first-party pointer or file changes.',
  interpretation: entry.note
});
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn)
  || String(a.observed_at || '').localeCompare(String(b.observed_at || '')));
fs.writeFileSync(manualPath, `${JSON.stringify(manual, null, 2)}\n`);

console.log(JSON.stringify({ applied: proof.ccn, finding: entry.finding,
  priorTarget: proof.sources.prior_target.url, currentTarget: proof.sources.current_mrf.url,
  bytes: proof.sources.current_mrf.bytes, sha256: proof.sources.current_mrf.sha256,
  cmsValidator: proof.structure.cms_validator }, null, 2));
