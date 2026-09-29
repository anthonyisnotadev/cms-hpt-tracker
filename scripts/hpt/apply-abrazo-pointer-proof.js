'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const { normalizeUrl } = require('./pointer-corpus');
const ROOT = path.resolve(__dirname, '../..');
const AUDIT = path.join(ROOT, 'data/hpt-audit');
const pointer = JSON.parse(fs.readFileSync(path.join(AUDIT, 'reconciliation-abrazo-pointer-proof.json'), 'utf8'));
const files = new Map(JSON.parse(fs.readFileSync(path.join(AUDIT, 'reconciliation-abrazo-manual-proof.json'), 'utf8')).records.map(r => [r.ccn, r]));
const bases = new Map(csvToObjects(fs.readFileSync(path.join(AUDIT, 'compliance.csv'), 'utf8')).map(r => [r.ccn, r]));
const ledgerPath = path.join(AUDIT, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (pointer.pointer_http_status !== 200 || pointer.pointer_bytes !== 2402 || !/^[a-f0-9]{64}$/.test(pointer.pointer_sha256)
    || pointer.records.length !== 4) throw new Error('Incomplete Abrazo root-pointer proof');
for (const entry of pointer.records) {
  const file = files.get(entry.ccn), base = bases.get(entry.ccn);
  if (!file || !base || normalizeUrl(file.mrf_url || entry.mrf_url) !== normalizeUrl(entry.mrf_url)
      || file.status !== 'file-address-corroborated-pointer-review-required' || !file.address_agrees
      || !file.license_state_agrees || file.metadata.version !== '3.0.0' || file.metadata.license_state !== base.state)
    throw new Error(`Incomplete Abrazo file/identity proof ${entry.ccn}`);
  const evidence = {
    identity: 'corroborated', identity_basis: 'current-official-page-root-pointer-and-retained-file-root-bytes',
    pointerUrl: pointer.pointer_url, pointerSha256: pointer.pointer_sha256, pointerBytes: pointer.pointer_bytes,
    url: entry.mrf_url, fileSha256: file.sha256, bytesRetained: file.bytes, http_status: file.http_status,
    checked_at: pointer.observed_at, date: file.metadata.date, version: file.metadata.version,
    officialDomain: 'abrazohealth.com', location_name: file.metadata.location_name,
    declared_hospital_name: file.metadata.hospital_name, declared_address: file.metadata.address,
    declared_license_state: file.metadata.license_state, file_kind: file.file_kind,
    sourcePageUrl: pointer.source_page_url
  };
  const note = `Current first-party pricing page and root pointer link the exact ${entry.location_name} file; retained root bytes identify ${file.metadata.location_name} at ${file.metadata.address}, ${file.metadata.license_state}, dated ${file.metadata.date}, CMS ${file.metadata.version}.`;
  const existing = ledger.find(row => row.ccn === entry.ccn);
  if (existing) {
    if (!(existing.action === 'replace' && existing.evidence_run === 'abrazo-root-pointer-browser-proof-2026-09-15'
        && JSON.stringify(existing.evidence) === JSON.stringify(evidence))) throw new Error(`Existing nonmatching resolution ${entry.ccn}`);
  } else ledger.push({ ccn: entry.ccn, base, action: 'replace', evidence,
    evidence_run: 'abrazo-root-pointer-browser-proof-2026-09-15', reviewed_at: pointer.observed_at, note });
}
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: pointer.records.map(r => r.ccn), pointer_sha256: pointer.pointer_sha256 }, null, 2));
