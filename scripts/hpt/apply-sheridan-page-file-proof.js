'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { extractDeclared } = require('./lib/probe');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-sheridan-page-file-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === proof.ccn);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const retained = role => {
  const item = proof[role];
  const file = path.resolve(root, item.retained_sample);
  if (!file.startsWith(root + path.sep)) throw new Error('Proof sample outside repository');
  const bytes = fs.readFileSync(file);
  if (sha(bytes) !== (role === 'file' ? item.sample_sha256 : item.sha256))
    throw new Error(`Sheridan ${role} sample hash mismatch`);
  return bytes;
};
const pointer = retained('pointer');
const page = retained('source_page');
const file = retained('file');
const meta = extractDeclared(file, 'csv');
if (proof.ccn !== '231312' || !base || base.finding !== 'not-assessed-domain-unknown'
  || base.domain || proof.pointer.http_status !== 200
  || proof.pointer.final_url !== 'https://www.sheridanhospital.com/cms-hpt.txt/'
  || !/^text\/html/i.test(proof.pointer.content_type)
  || !/^\s*<!doctype html/i.test(pointer.toString('utf8'))
  || !page.includes(Buffer.from(proof.file.url))
  || proof.file.http_status !== 206 || file.length !== 262144
  || proof.file.content_range !== 'bytes 0-262143/68769805'
  || meta.hospitalName !== 'Sheridan Community Hospital'
  || meta.locationName !== 'Sheridan Community Hospital'
  || meta.address !== '301 N Main Street, Sheridan, MI, 48884'
  || meta.licenseState !== 'MI' || meta.raw !== '4/22/2026'
  || meta.version !== '3.0.0') throw new Error('Incomplete Sheridan page/file proof');

const evidence = {
  identity: 'corroborated', identity_basis: 'first-party-pricing-page-and-file-header-exact-street-city-state',
  pointerUrl: proof.pointer.url, pointerSha256: proof.pointer.sha256,
  pointerHttpStatus: proof.pointer.http_status, pointerContentType: proof.pointer.content_type,
  url: proof.file.url, fileSha256: proof.file.sample_sha256,
  http_status: proof.file.http_status, checked_at: proof.observed_at,
  date: proof.file.declared_date, version: meta.version, officialDomain: 'sheridanhospital.com',
  location_name: meta.locationName, declared_hospital_name: meta.hospitalName,
  declared_address: meta.address, declared_license_state: meta.licenseState,
  file_kind: 'csv', sourcePageUrl: proof.source_page.url,
  sourcePageSha256: proof.source_page.sha256,
  observedFinding: 'root-pointer-html-page-with-official-page-file',
  pointerIssue: 'root-path-serves-html-page',
  next_action: 'Retain the dated first-party page-linked CSV and exact facility header. Recheck whether root cms-hpt.txt begins serving a structured pointer to this file; do not treat the HTML page as one.'
};
const entry = { ccn: proof.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'sheridan-html-root-page-file-2026-09-17-231312', reviewed_at: proof.observed_at,
  note: 'The current first-party root path redirects to HTTP 200 HTML, not a structured pointer. The official patient page links the April 2026 CSV whose bounded 262,144-byte header names Sheridan Community Hospital at the CMS roster address in Michigan, declares 2026-04-22 and template 3.0.0. The full 68.8 MB file and individual rates were not validated; no compliance conclusion follows.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Sheridan review');
if (!old) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !old, ccn: proof.ccn }));
