'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-arkansas-valley-pointer-proof.json'), 'utf8'));
const officialPageRecords = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-official-page-file-observations.json'), 'utf8')).records;
const pageRecord = officialPageRecords.find(record => record.ccn === proof.ccn);
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
const pointerPath = path.join(root, proof.pointer_file);
const pointerBody = fs.readFileSync(pointerPath, 'utf8');
const pointerSha256 = crypto.createHash('sha256').update(fs.readFileSync(pointerPath)).digest('hex');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));

if (!base || base.finding !== 'not-assessed-domain-unknown'
    || pointerSha256 !== proof.pointer_sha256
    || !pointerBody.includes(`location-name: ${proof.pointer_location_name}`)
    || !pointerBody.includes(`source-page-url: ${proof.source_page_url}`)
    || !pointerBody.includes(`mrf-url: ${proof.pointer_mrf_url}`)
    || proof.browser_final_url !== proof.pointer_mrf_url
    || proof.browser_http_status !== 200 || proof.browser_retained_bytes !== 262144
    || !pageRecord || pageRecord.mrf_url !== proof.browser_requested_url
    || pageRecord.file_bytes !== proof.full_file_bytes || pageRecord.file_sha256 !== proof.full_file_sha256
    || proof.declared_hospital_name !== 'Arkansas Valley Regional Medical Center'
    || proof.declared_state !== 'CO' || proof.declared_date !== '2025-07-17'
    || proof.version !== '3.0.0' || proof.finding !== 'mrf-stale-over-365-days') {
  throw new Error('Incomplete Arkansas Valley proof or changed base evidence');
}

const evidence = {
  identity: 'corroborated',
  identity_basis: 'exact-official-pointer-name-and-file-plus-first-party-pricing-page-file-address-and-state',
  pointerUrl: proof.pointer_url,
  pointerSha256: proof.pointer_sha256,
  url: proof.pointer_mrf_url,
  fileSha256: proof.full_file_sha256,
  http_status: proof.browser_http_status,
  checked_at: proof.observed_at,
  date: proof.declared_date,
  version: proof.version,
  officialDomain: proof.official_domain,
  location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_state,
  file_kind: 'json',
  sourcePageUrl: proof.source_page_url,
  observedFinding: proof.finding,
};
const entry = {
  ccn: proof.ccn,
  base,
  action: 'replace-observation',
  evidence,
  evidence_run: 'arkansas-valley-pointer-file-2026-09-16',
  reviewed_at: proof.observed_at,
  note: proof.note,
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))
    throw new Error('Existing nonmatching Arkansas Valley resolution');
  console.log('{"applied":false}');
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }, null, 2));
