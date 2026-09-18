'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-j-paul-jones-current-mrf-proof.json'), 'utf8'));
const retained = path.join(root, proof.retained_file);
const digest = crypto.createHash('sha256').update(fs.readFileSync(retained)).digest('hex');
if (digest !== proof.full_file_sha256) throw new Error('J Paul Jones retained file hash changed');
if (proof.ccn !== '010781' || proof.response_status !== 200 || proof.cms_template_version !== '3.0.0'
  || proof.declared_license_state !== 'AL' || proof.full_file_bytes < 1000000) throw new Error('Incomplete J Paul Jones proof');
const base = fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8').split(/\r?\n/)
  .slice(1).map(line => line.split(',')).map(fields => ({
    ccn: fields[0], hospital_name: fields[1], city: fields[2], state: fields[3], type: fields[4],
    finding: fields[5], assessable: fields[6], evidence: fields[7], domain: fields[8], pointer_url: fields[9],
    mrf_url: fields[10], mrf_last_updated: fields[11], mrf_days_since_update: fields[12], cms_template_version: fields[13], checked_at: fields[14]
  })).find(row => row.ccn === proof.ccn);
if (!base) throw new Error('J Paul Jones compliance row missing');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-pricing-page-exact-campus-and-complete-mrf-header-address-state',
  officialDomain: proof.official_domain,
  sourcePageUrl: proof.source_page_url,
  sourcePageSha256: proof.source_page_sha256,
  pointerUrl: proof.pointer_url,
  pointerHttpStatus: proof.pointer_http_status,
  pointerSha256: proof.pointer_sha256,
  pointerIssue: proof.pointer_issue,
  url: proof.mrf_url,
  finalUrl: proof.mrf_final_url,
  fileSha256: proof.full_file_sha256,
  http_status: proof.response_status,
  checked_at: proof.observed_at,
  date: proof.declared_last_updated,
  as_of_date: proof.declared_as_of_date,
  version: proof.cms_template_version,
  officialPage: proof.source_page_url,
  declared_hospital_name: proof.declared_hospital_name,
  declared_location_name: proof.declared_location_name,
  declared_address: proof.declared_address,
  facility_address: '317 McWilliams Avenue, Camden, AL 36726',
  declared_license_state: proof.declared_license_state,
  facility_state: 'AL',
  file_kind: 'csv',
  fullFileBytes: proof.full_file_bytes,
  full_file_sha256: proof.full_file_sha256,
  retained_file: proof.retained_file,
  observedFinding: proof.observed_finding,
  next_action: 'Ask the publisher to restore a root cms-hpt.txt pointer to this exact current MRF, then recheck pointer linkage; retain the current page-linked file and metadata meanwhile.'
};
const nextResolution = {
  ccn: proof.ccn,
  base,
  action: 'replace-observation',
  evidence,
  evidence_run: 'j-paul-jones-current-page-linked-mrf-2026-09-18',
  reviewed_at: proof.observed_at,
  note: 'The official J. Paul Jones Services page links a complete CSV MRF through a Panacea redirect. The retained file declares J. Paul Jones Hospital, the exact Camden address, Alabama license state, 2026-04-17 date and CMS 3.0.0. The root cms-hpt.txt URL is 404, so pointer linkage remains an explicit follow-up; no legal compliance or line-item validity conclusion is inferred.'
};
const existingIndex = ledger.findIndex(row => row.ccn === proof.ccn);
if (existingIndex >= 0) ledger[existingIndex] = nextResolution;
else ledger.push(nextResolution);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: proof.ccn, file_sha256: proof.full_file_sha256, full_file_bytes: proof.full_file_bytes }, null, 2));
