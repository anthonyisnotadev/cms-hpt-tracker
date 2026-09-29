'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { extractDeclared } = require('./lib/probe');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-lindsay-page-file-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === proof.ccn);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const retained = role => {
  const item = proof[role];
  const file = path.resolve(root, item.retained_sample);
  if (!file.startsWith(root + path.sep)) throw new Error('Proof sample outside repository');
  const bytes = fs.readFileSync(file);
  if (sha(bytes) !== (role === 'file' ? item.sample_sha256 : item.sha256))
    throw new Error(`Lindsay ${role} sample hash mismatch`);
  return bytes;
};
const pointer = retained('pointer');
const page = retained('source_page');
const file = retained('file');
const meta = extractDeclared(file, 'csv');
if (proof.ccn !== '370214' || !base || base.finding !== 'compliant-observed'
  || base.domain !== 'lindsayhospital.com' || proof.pointer.http_status !== 200
  || proof.pointer.final_url !== 'https://lindsayhospital.com/cms-hpt.txt/'
  || !/^text\/html/i.test(proof.pointer.content_type)
  || !/^\s*<!doctype html/i.test(pointer.toString('utf8'))
  || !page.includes(Buffer.from(proof.file.url))
  || !page.includes(Buffer.from('308 W. Cherokee'))
  || proof.file.http_status !== 206 || file.length !== 262144
  || proof.file.content_range !== 'bytes 0-262143/6686934'
  || meta.hospitalName !== 'Lindsay Municipal Hospital Authority'
  || meta.locationName !== 'Lindsay Municipal Hospital'
  || meta.address !== '1305 W Cherokee, Lindsay, OK, 73052'
  || meta.licenseState !== 'OK' || meta.raw !== '4/3/2026'
  || meta.version !== '3.0.0') throw new Error('Incomplete Lindsay page/file proof');

const evidence = {
  identity: 'corroborated', identity_basis: 'first-party-pricing-page-and-file-header-exact-name-street-city-state',
  pointerUrl: proof.pointer.url, pointerSha256: proof.pointer.sha256,
  pointerHttpStatus: proof.pointer.http_status, pointerContentType: proof.pointer.content_type,
  url: proof.file.url, fileSha256: proof.file.sample_sha256,
  http_status: proof.file.http_status, checked_at: proof.observed_at,
  date: proof.file.declared_date, version: meta.version, officialDomain: 'lindsayhospital.com',
  location_name: meta.locationName, declared_hospital_name: meta.hospitalName,
  declared_address: meta.address, declared_license_state: meta.licenseState,
  file_kind: 'csv', sourcePageUrl: proof.source_page.url,
  sourcePageSha256: proof.source_page.sha256,
  addressContext: proof.source_page.address_context,
  observedFinding: 'root-pointer-html-page-with-official-page-file',
  pointerIssue: 'root-path-serves-html-page',
  next_action: 'Retain the dated page-linked CSV and the separate business-office versus hospital-address context. Recheck whether root cms-hpt.txt begins serving a structured pointer to this file; do not renew the older pointer-backed claim from the HTML page.'
};
const entry = { ccn: proof.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'lindsay-html-root-page-file-2026-09-17-370214', reviewed_at: proof.observed_at,
  note: 'The current root path redirects to HTTP 200 HTML, not a structured pointer. The first-party patient-information page links a CSV whose bounded 262,144-byte header names Lindsay Municipal Hospital at 1305 W Cherokee in Oklahoma, matching the CMS roster and state hospital directory. The page also lists 308 W Cherokee specifically under Business Office and Medical Records; that is not substituted for the hospital-location field. The full 6.7 MB file and individual rates were not validated. The previous compliant-observed finding remains dated history, not a renewed legal verdict.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Lindsay review');
if (!old) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !old, ccn: proof.ccn }));
