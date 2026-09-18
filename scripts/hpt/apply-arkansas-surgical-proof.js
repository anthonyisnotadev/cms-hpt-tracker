'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-arkansas-surgical-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn);
const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
  .find(item => item.ccn === row.ccn);
const sample = fs.readFileSync(path.join(root, row.retained_sample));
if (row.ccn !== '040147' || !base || base.finding !== 'no-cms-hpt-txt-published'
    || base.domain !== 'clariti-health.com' || base.mrf_url
    || !roster || roster.address !== '5201 NORTH SHORE DRIVE'
    || roster.city !== 'NO LITTLE ROCK' || roster.state !== 'AR' || roster.zip !== '72118'
    || row.official_domain !== 'arksurgicalhospital.com'
    || row.pointer_http_status !== 200 || row.mrf_http_status !== 200
    || row.pointer_url !== 'https://arksurgicalhospital.com/cms-hpt.txt'
    || row.pointer_final_url !== 'https://arksurgicalhospital.com/wp-content/uploads/2026/01/cms-hpt-1.txt'
    || row.mrf_url !== 'https://clariti-health.com/csp/clariti/machinereadable/v2/710858717_Arkansas-Surgical-Hospital-LLC_standardcharges.csv'
    || row.retained_bytes !== 262144 || sample.length !== 262144
    || crypto.createHash('sha256').update(sample).digest('hex') !== row.mrf_sample_sha256
    || row.declared_hospital_name !== 'Arkansas Surgical Hospital, LLC'
    || row.declared_location_name !== 'Arkansas Surgical Hospital, LLC'
    || row.declared_address !== '5201 Northshore Drive,,North Little Rock,AR,72118'
    || row.declared_state !== 'AR' || row.declared_date !== '2026-03-13'
    || row.version !== '3.0.0') {
  throw new Error('Incomplete Arkansas Surgical pointer/file proof');
}
const evidence = {
  identity: 'corroborated',
  identity_basis: 'hospital-owned-domain-root-pointer-and-exact-vendor-file-header-name-street-city-state-zip',
  pointerUrl: row.pointer_url, pointerFinalUrl: row.pointer_final_url,
  pointerSha256: row.pointer_sha256, pointerHttpStatus: row.pointer_http_status,
  url: row.mrf_url, fileSha256: row.mrf_sample_sha256,
  http_status: row.mrf_http_status, checked_at: row.observed_at,
  date: row.declared_date, version: row.version, officialDomain: row.official_domain,
  location_name: row.declared_location_name,
  declared_hospital_name: row.declared_hospital_name,
  declared_address: row.declared_address,
  declared_license_state: row.declared_state,
  file_kind: 'csv', sourcePageUrl: row.source_page_url,
  officialIdentityUrl: row.official_page_url,
  next_action: row.next_action,
};
const entry = { ccn: row.ccn, base, action: 'replace', evidence,
  evidence_run: 'arkansas-surgical-hospital-direct-pointer-file-2026-09-16-040147',
  reviewed_at: row.observed_at,
  note: 'The earlier crawl treated the Clariti vendor as the official hospital domain and called its missing root pointer an absent hospital pointer. The hospital-owned Arkansas Surgical site currently redirects its root cms-hpt.txt to a plain-text pointer naming the same Clariti CSV. A retained 262,144-byte bounded CSV header declares Arkansas Surgical Hospital, LLC at 5201 Northshore Drive, North Little Rock, Arkansas 72118, matching the roster North Shore Drive / NO LITTLE ROCK shorthand, with Arkansas license state, 2026-03-13 and CMS 3.0.0. This is pointer/header observation only, not full-file validation or a legal conclusion. The direct client was challenged on the patient-resources page; the browser-rendered hospital page separately named its Clariti price-transparency link.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(item => item.ccn === row.ccn);
if (old && (old.evidence_run !== entry.evidence_run
    || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
  throw new Error('Existing nonmatching Arkansas Surgical resolution');
}
if (!old) {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: !old, ccn: row.ccn }));
