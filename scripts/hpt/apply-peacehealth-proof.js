'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const compliance = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const records = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-peacehealth-proof.json'), 'utf8')).records;
let added = 0;

for (const row of records) {
  if (row.status !== 'identity-corroborated' || !row.pointer_sha256 || !row.file_sha256 || !row.payload_sha256
      || !row.metadata?.date || row.metadata?.version !== '3.0.0') throw new Error(`Incomplete PeaceHealth proof ${row.ccn}`);
  const evidence = { identity: 'corroborated', identity_basis: 'official-pointer-label-and-file-street-state',
    pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256, url: row.mrf_url,
    fileSha256: row.file_sha256, payloadSha256: row.payload_sha256, http_status: row.http_status,
    checked_at: row.observed_at, date: row.metadata.date, version: row.metadata.version,
    officialDomain: 'peacehealth.org', location_name: row.metadata.location_name,
    declared_hospital_name: row.metadata.hospital_name, declared_address: row.metadata.address,
    declared_license_state: row.metadata.license_state, file_kind: row.payload_kind,
    sourcePageUrl: row.source_page_url, pointer_route: row.pointer_route };
  const note = 'Fresh official root pointer and bounded file review corroborate this PeaceHealth facility by facility-specific pointer label, street address and state. The prior manual page link is retained as history, while this reviewed pointer/file proof supplies the standing finding.';
  const existing = ledger.find(item => item.ccn === row.ccn);
  if (existing) {
    if (existing.action === 'replace' && existing.evidence_run === 'peacehealth-byte-review-2026-09-15'
        && JSON.stringify(existing.evidence) === JSON.stringify(evidence)) continue;
    throw new Error(`Existing nonmatching resolution ${row.ccn}`);
  }
  const base = compliance.get(row.ccn);
  if (!base) throw new Error(`Missing compliance base ${row.ccn}`);
  ledger.push({ ccn: row.ccn, base, action: 'replace', evidence, evidence_run: 'peacehealth-byte-review-2026-09-15',
    reviewed_at: row.observed_at, note });
  added++;
}
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ added }, null, 2));
