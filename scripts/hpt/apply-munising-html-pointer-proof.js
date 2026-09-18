'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-munising-html-pointer-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '231308');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
const pointerPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/munisingmemorial.org-35fa286dc7c2.txt');
const samplePath = path.join(root, proof.retained_sample);

if (!base || base.finding !== 'compliant-date-unverified' || base.mrf_url !== proof.pointer_mrf_url
    || !fs.existsSync(pointerPath) || proof.pointer_sha256 !== sha(fs.readFileSync(pointerPath))
    || !fs.existsSync(samplePath) || proof.file_sha256 !== sha(fs.readFileSync(samplePath))
    || proof.page_http_status !== 206 || proof.file_http_status !== 206
    || proof.retained_bytes < 65536 || proof.version !== '2.2.0'
    || proof.declared_state !== 'MI' || proof.declared_location_name !== 'Munising Memorial Hospital'
    || proof.declared_date !== '2025-01-01')
  throw new Error('Munising evidence incomplete or base changed');

const evidence = {
  identity: 'corroborated', identity_basis: 'official-contact-page-pointer-location-html-billing-page-link-and-file-exact-street-city-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerMrfUrl: proof.pointer_mrf_url, pointerMrfHttpStatus: proof.page_http_status,
  url: proof.file_url, fileSha256: proof.file_sha256, http_status: proof.file_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
  declared_license_state: proof.declared_state, file_kind: 'csv',
  sourcePageUrl: proof.pointer_mrf_url, sourcePageSha256: proof.page_sha256,
  identityPageUrl: proof.identity_url, identityPageSha256: proof.identity_sha256,
  observedFinding: 'pointer-links-html-download-page-with-file',
  pointerIssue: 'mrf-url-resolves-html-page-linking-file'
};
const entry = {
  ccn: '231308', base, action: 'replace-observation', evidence,
  evidence_run: 'munising-html-pointer-stale-v2-2-file-2026-09-16', reviewed_at: proof.observed_at,
  note: 'The current root pointer names Munising Memorial Hospital but places the HTML billing page in mrf-url. That page links a separate CSV whose fresh bounded bytes identify the exact 1500 Sand Point Road, Munising, Michigan campus, but declare 2025-01-01 and CMS 2.2.0. Retain the stale/older-template metadata and the pointer defect as observed facts; do not call the CSV directly pointer-linked or make a legal compliance determination.'
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))
    throw new Error('Existing nonmatching Munising resolution');
  console.log('{"applied":false}');
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }, null, 2));
