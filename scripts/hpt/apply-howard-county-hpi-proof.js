'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-howard-county-hpi-file-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
if (!base || base.ccn !== '281338' || sample.length !== proof.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== proof.current_mrf_sha256
    || proof.current_mrf_http_status !== 206 || proof.version !== '3.0.0'
    || proof.declared_hospital_name !== 'Howard County Medical Center'
    || proof.declared_address !== '1113 Sherman Street, St. Paul, NE 68873'
    || proof.declared_state !== 'NE' || proof.declared_date !== '2026-02-04'
    || proof.source_page_heading !== 'Howard County Medical Center') throw new Error('Incomplete Howard County HPI proof');
const evidence = {
  identity: 'corroborated',
  identity_basis: 'first-party-pricing-page-plus-rendered-hpi-source-route-and-retained-file-header-name-address-state',
  url: proof.current_mrf_url,
  fileSha256: proof.current_mrf_sha256,
  http_status: proof.current_mrf_http_status,
  checked_at: proof.observed_at,
  date: proof.declared_date,
  version: proof.version,
  officialDomain: proof.official_domain,
  location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_state,
  file_kind: 'csv',
  sourcePageUrl: proof.source_page_url,
  sourcePageShellSha256: proof.source_page_shell_sha256,
  browserSourceHeading: proof.source_page_heading,
  browserSourceObservedAt: proof.official_pricing_observed_at,
  observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
  pointerIssue: 'no-current-root-pointer-hpi-source-page-file',
  next_action: proof.next_action,
  fullFileBytes: null,
};
const entry = {
  ccn: proof.ccn,
  base,
  action: 'replace-observation',
  evidence,
  evidence_run: 'howard-county-hpi-source-page-file-2026-09-19',
  reviewed_at: proof.observed_at,
  note: 'The current first-party Howard County Medical Center pricing page identifies the St. Paul, Nebraska facility and links its HPI machine-readable route. Browser automation rendered a separate HPI Download File URL whose retained CSV header identifies the same facility at 1113 Sherman Street, with Nebraska license state, 2026-02-04 date and CMS 3.0.0. The HPI intermediary is retained explicitly; this does not establish a root cms-hpt.txt pointer linkage or complete-file usability.'
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) throw new Error('Existing nonmatching Howard County resolution');
if (!old) { ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn)); fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n'); }
console.log(JSON.stringify({ applied: old ? false : proof.ccn, already_present: Boolean(old) }));
