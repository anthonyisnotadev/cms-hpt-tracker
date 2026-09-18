'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const p = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-plains-proof.json'), 'utf8')).records[0];
if (p.ccn !== '451350' || p.version !== '3.0.0' || p.pointer_http_status !== 200 || p.mrf_http_status !== 200
    || !p.pointer_sha256 || !p.mrf_sha256) throw new Error('Incomplete Plains Memorial proof');
const evidence = { identity: 'corroborated', identity_basis: 'official-root-pointer-dba-file-street-state',
  pointerUrl: p.pointer_url, pointerSha256: p.pointer_sha256, url: p.mrf_url, fileSha256: p.mrf_sha256,
  http_status: p.mrf_http_status, checked_at: p.observed_at, date: p.declared_date, version: p.version,
  officialDomain: 'castrocountyhospital.com', location_name: p.declared_location_name,
  declared_hospital_name: p.declared_hospital_name, declared_address: p.declared_address,
  declared_license_state: p.declared_state, file_kind: p.file_kind, sourcePageUrl: p.source_page_url };
const note = 'Fresh Castro County Hospital root pointer and complete ClaraPrice JSON review establish Plains Memorial Hospital by explicit DBA, Dimmitt street address and Texas license state. The earlier legacy-domain and missing-metadata observations remain historical only.';
const existing = ledger.find(row => row.ccn === p.ccn);
if (existing) {
  if (!(existing.action === 'replace' && existing.evidence_run === 'plains-full-file-review-2026-09-15'
      && JSON.stringify(existing.evidence) === JSON.stringify(evidence))) throw new Error(`Existing nonmatching resolution ${p.ccn}`);
} else {
  ledger.push({ ccn: p.ccn, base: bases.get(p.ccn), action: 'replace', evidence,
    evidence_run: 'plains-full-file-review-2026-09-15', reviewed_at: p.observed_at, note });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: p.ccn, mrf_url: p.mrf_url }, null, 2));
