'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-knox-barbourville-current-mrf-proof-2026-09-27.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
if (proof.malformed_row_widths !== 0 || proof.data_rows < 1 || proof.cms_enrollment_matches?.ccn !== proof.ccn
    || proof.cms_enrollment_matches?.npi !== '1992176655' || proof.pointer_status !== 200 || proof.mrf_status !== 200)
  throw new Error('Proof does not satisfy the reviewed identity, retrieval, and structural gates');

const compliance = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
const base = compliance.find(row => row.ccn === proof.ccn);
if (!base) throw new Error(`Missing compliance base row for ${proof.ccn}`);
const oldManual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'));
const prior = oldManual.records.find(row => row.ccn === proof.ccn);

const evidence = {
  identity: 'corroborated',
  identity_basis: 'current-root-pointer-exact-file-full-csv-structure-cms-enrollment-ccn-npi-address-name-state-date-version-attestation',
  officialDomain: proof.official_domain,
  pointerUrl: proof.pointer_url,
  pointerSha256: proof.pointer_sha256,
  pointerLocationName: proof.pointer_entry_label,
  url: proof.mrf_url,
  finalUrl: proof.mrf_url,
  http_status: proof.mrf_status,
  checked_at: proof.observed_at,
  date: '2026-01-01',
  version: proof.cms_template_version,
  declared_hospital_name: proof.declared_hospital_name,
  location_name: proof.declared_location_name,
  declared_address: proof.declared_address,
  facility_address: '80 Hospital Drive, Barbourville, KY 40906',
  declared_license_number: proof.declared_license_number,
  declared_license_state: proof.declared_license_state,
  facility_state: 'KY',
  declared_npi: proof.cms_enrollment_matches.npi,
  additionalDeclaredNpis: '1912050733',
  file_kind: proof.file_kind,
  fileSha256: proof.mrf_sha256,
  fullFileBytes: proof.mrf_total_bytes,
  columns: proof.columns,
  dataRows: proof.data_rows,
  malformedRowWidths: proof.malformed_row_widths,
  attestationPresent: proof.declared_attestation,
  cmsEnrollmentQueryUrl: proof.cms_enrollment_query_url,
  cmsEnrollmentResponseSha256: proof.cms_enrollment_response_sha256,
  observedFinding: 'date-within-365-days-version-3'
};
const entry = {
  ccn: proof.ccn,
  base,
  action: 'replace',
  finding: 'verified-current-mrf',
  evidence,
  evidence_run: 'knox-barbourville-full-current-pointer-file-and-cms-enrollment-crosswalk-2026-09-27',
  reviewed_at: proof.observed_at,
  note: 'Current ARH root pointer links the exact Barbourville CSV. The complete 10,723,055-byte CMS 3.0.0 file has 27 columns, 52,260 nonempty data rows, and no quote-aware row-width errors; its date, address, KY license metadata and NPI agree with the exact CMS enrollment row and current hospital roster. Observed file evidence only; not a legal compliance conclusion.'
};

const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const index = ledger.findIndex(row => row.ccn === proof.ccn);
if (index >= 0) ledger[index] = entry;
else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
oldManual.records = oldManual.records.filter(row => row.ccn !== proof.ccn);
oldManual.records.push({
  ...proof,
  proof_file: proofName,
  disposition: 'current-official-pointer-file-and-cms-enrollment-identity-metadata-and-usability-confirmed',
  next_action: 'Retain the full-file and exact-CCN CMS crosswalk proof; recheck on the normal freshness schedule and do not infer a legal compliance conclusion.',
  facility_file_url: proof.mrf_url,
  file_range_status: 'complete-200-streamed',
  file_sample_bytes: proof.mrf_total_bytes,
  file_sample_sha256: proof.mrf_sha256,
  manual_identity_gate: 'official-pointer-full-file-exact-ccn-cms-enrollment-agree',
  prior_dns_and_pointer_observation_retained: Boolean(prior),
  prior_manual_observation_at: prior?.observed_at || ''
});
oldManual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, `${JSON.stringify(oldManual, null, 2)}\n`);
console.log(JSON.stringify({ applied: proof.ccn, finding: entry.finding, rows: proof.data_rows, malformed: proof.malformed_row_widths }, null, 2));
