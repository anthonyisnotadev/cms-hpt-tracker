'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-summit-oklahoma-page-file-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
if (!base || base.ccn !== '370225' || sample.length !== proof.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== '22d08afe0d997b9205a475902afc64cc51e8d80d1e1f436aa5ea8e9b7230f989')
  throw new Error('Incomplete Summit Oklahoma page-file proof');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'first-party-estimator-download-and-retained-complete-file-header-exact-name-address-state-date-version',
  officialDomain: proof.official_domain,
  pointerUrl: proof.root_pointer_url,
  pointerHttpStatus: proof.root_pointer_status,
  pointerSha256: proof.root_pointer_sha256,
  pointerIssue: 'root-pointer-http-error',
  url: proof.mrf_url,
  fileSha256: proof.mrf_sha256,
  fileBytes: proof.mrf_bytes,
  fullFileBytes: proof.mrf_bytes,
  http_status: proof.mrf_http_status,
  checked_at: proof.observed_at,
  date: proof.declared_date,
  version: proof.cms_template_version,
  location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_state,
  file_kind: 'csv',
  sourcePageUrl: proof.official_source_page_url,
  browserSourceObservedAt: proof.observed_at,
  observedFinding: 'official-page-mrf-root-pointer-unavailable',
  next_action: proof.next_action,
};
const entry = {
  ccn: proof.ccn,
  base,
  action: 'replace-observation',
  evidence,
  evidence_run: 'summit-oklahoma-page-file-root-pointer-2026-09-19',
  reviewed_at: proof.observed_at,
  note: 'The first-party Summit Medical Center site links its price-transparency estimator, whose Download MRF route returned a complete 18,567,964-byte CSV. The header identifies Summit Medical Center, LLC at 1800 South Renaissance Boulevard, Edmond, Oklahoma, dated 2026-09-01 with CMS 3.0.0. The first-party root cms-hpt.txt remains a 404, so this is page-linked current-file evidence rather than pointer-linked or a compliance conclusion.'
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) throw new Error('Existing nonmatching Summit Oklahoma resolution');
if (!old) { ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn)); fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n'); }
console.log(JSON.stringify({ applied: old ? false : proof.ccn, already_present: Boolean(old) }));
