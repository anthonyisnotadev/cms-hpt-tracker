'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofName = 'reconciliation-resurrection-medical-center-current-pointer-file-proof-2026-09-30.json';
const proof = JSON.parse(fs.readFileSync(path.join(audit, proofName), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-access-observations.json'), 'utf8'))
  .records.find(record => record.ccn === proof.ccn);
if (proof.ccn !== '140117' || manual?.disposition !== 'verified-current-mrf'
  || manual.cms_template_version !== '3.0'
  || proof.current_mrf.cms_validator.result !== 'no errors, 1 alert')
  throw new Error('Resurrection v3 family evidence is not in the expected reviewed state');

const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(record => record.ccn === proof.ccn);
if (!base || !['compliant-observed', 'mrf-template-version-noncanonical'].includes(base.finding))
  throw new Error('Resurrection base finding changed; review before applying this correction');

const evidence = {
  identity: 'corroborated',
  identityBasis: 'current-first-party-pricing-page-and-complete-root-pointer-link-exact-file-full-json-cms-v3-validation',
  identity_basis: 'exact-current-root-pointer-and-official-page-full-file-hash-facility-address-license-state-date-cms-v3-family-and-usable-json',
  pointerIssue: 'current-root-pointer-and-page-link-exact-mrf',
  officialDomain: 'resurrectionmedicalcenter.com',
  sourcePageUrl: proof.official_pricing_page,
  pointerUrl: proof.current_pointer.url,
  pointerSha256: proof.current_pointer.sha256,
  pointerHttpStatus: proof.current_pointer.http_status,
  pointerLocationName: 'Resurrection Medical Center',
  pointerMrfUrl: proof.current_mrf.url,
  url: proof.current_mrf.url,
  finalUrl: proof.current_mrf.url,
  http_status: proof.current_mrf.http_status,
  checked_at: proof.observed_at,
  date: proof.current_mrf.declared_last_updated,
  version: proof.current_mrf.declared_version,
  declared_hospital_name: proof.current_mrf.declared_hospital_name,
  location_name: proof.current_mrf.declared_location_name,
  declared_address: proof.current_mrf.declared_address,
  declared_license_number: proof.current_mrf.declared_license_number,
  declared_license_state: proof.current_mrf.declared_license_state,
  declared_npi: proof.current_mrf.declared_npi.join('|'),
  file_kind: 'json',
  fileSha256: proof.current_mrf.sha256,
  fullFileSha256: proof.current_mrf.sha256,
  fullFileBytes: proof.current_mrf.bytes,
  completeFileValidated: true,
  fileKind: 'json',
  jsonSchemaVersion: '3.0.0',
  jsonDataRows: proof.current_mrf.parsed_charge_rows,
  jsonUsableChargeRows: proof.current_mrf.parsed_charge_rows,
  attestationPresent: proof.current_mrf.attestation_confirmed,
  cmsValidator: {
    cli_package: '@cmsgov/hpt-validator-cli@1.10.8',
    package: '@cmsgov/hpt-validator-cli',
    version: '1.10.8',
    dictionary_version: '3.0.0',
    requirements: 'v3.0',
    format: 'json',
    valid: true,
    errors: 0,
    alerts: 1,
    alert: proof.current_mrf.cms_validator.alert,
    interpretation: 'CMS Data Dictionary v3.0; literal file version 3.0 counts as version 3 per user-confirmed policy; retain validator alert as warning'
  },
  observedFinding: 'verified-current-mrf'
};
const entry = {
  ccn: proof.ccn,
  base,
  action: 'replace-observation',
  finding: 'verified-current-mrf',
  evidence,
  evidence_run: 'resurrection-current-root-pointer-full-mrf-cms-v3-family-2026-09-30',
  reviewed_at: proof.observed_at,
  note: 'The current first-party root pointer and rendered price-transparency page link the exact complete September JSON. Full bytes/hash, facility identity/address/IL license metadata, date, attestation and 5,189 usable charge rows are verified. CMS v3.0 validation has zero errors and one version-string alert because the file declares 3.0 rather than 3.0.0; under the user-confirmed version-family rule, 3.0 counts as version 3 and the alert is retained as a warning, not a blocking finding. This is an observed current-MRF classification, not a legal compliance conclusion.'
};

const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const index = ledger.findIndex(record => record.ccn === proof.ccn);
if (index >= 0) ledger[index] = entry;
else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ ccn: proof.ccn, finding: entry.finding, version: evidence.version, validator_alerts: 1 }));
