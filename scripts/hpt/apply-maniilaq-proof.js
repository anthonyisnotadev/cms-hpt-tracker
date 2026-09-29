'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const p = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-maniilaq-proof.json'), 'utf8')).records[0];
if (p.ccn !== '021310' || p.version !== '3.0.0' || p.pointer_http_status !== 200 || p.mrf_http_status !== 200
    || !p.pointer_sha256 || !p.mrf_sha256) throw new Error('Incomplete Maniilaq proof');
const evidence = { identity: 'corroborated', identity_basis: 'first-party-pointer-label-and-file-street-state',
  pointerUrl: p.pointer_url, pointerSha256: p.pointer_sha256, url: p.mrf_url, fileSha256: p.mrf_sha256,
  http_status: p.mrf_http_status, checked_at: p.observed_at, date: p.declared_date, version: p.version,
  officialDomain: 'maniilaq.org', location_name: p.pointer_location_name,
  declared_hospital_name: p.declared_hospital_name, declared_address: p.declared_address,
  declared_license_state: p.declared_state, file_kind: p.file_kind, sourcePageUrl: p.source_page_url };
const note = 'Fresh Maniilaq root pointer and complete PARA CSV review establish the pointer-declared file by exact facility pointer label, Kotzebue street address and Alaska state. The unrelated S3 chargemaster assignment remains in history but is not standing evidence.';
const existing = ledger.find(row => row.ccn === p.ccn);
if (existing) {
  if (!(existing.action === 'replace' && existing.evidence_run === 'maniilaq-full-file-review-2026-09-15'
      && JSON.stringify(existing.evidence) === JSON.stringify(evidence))) throw new Error(`Existing nonmatching resolution ${p.ccn}`);
} else {
  ledger.push({ ccn: p.ccn, base: bases.get(p.ccn), action: 'replace', evidence,
    evidence_run: 'maniilaq-full-file-review-2026-09-15', reviewed_at: p.observed_at, note });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: p.ccn, mrf_url: p.mrf_url }, null, 2));
