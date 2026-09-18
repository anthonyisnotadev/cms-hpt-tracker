'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const p = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-harrison-proof.json'), 'utf8')).records[0];
if (p.ccn !== '361311' || p.pointer_issue !== 'omitted-mrf-url-label' || p.version !== '3.0.0'
    || p.pointer_http_status !== 200 || p.mrf_http_status !== 206 || !p.pointer_sha256 || !p.mrf_header_sha256)
  throw new Error('Incomplete Harrison proof');
const evidence = { identity: 'corroborated', identity_basis: 'pointer-label-and-file-name-street-state',
  pointerUrl: p.pointer_url, pointerSha256: p.pointer_sha256, url: p.mrf_url,
  fileHeaderSha256: p.mrf_header_sha256, http_status: p.mrf_http_status, checked_at: p.observed_at,
  date: p.declared_date, version: p.version, officialDomain: 'wvumedicine.org', location_name: p.declared_location_name,
  declared_hospital_name: p.declared_hospital_name, declared_address: p.declared_address,
  declared_license_state: p.declared_state, file_kind: p.file_kind, sourcePageUrl: p.source_page_url,
  observedFinding: 'pointer-lists-no-mrf-url', pointerIssue: p.pointer_issue };
const note = 'The current WVU root pointer labels Harrison Community Hospital and places the exact live CSV directly after source-page-url, but omits the mrf-url field label. The current v3 file identity and metadata are retained while the pointer defect is reported explicitly.';
const existing = ledger.find(row => row.ccn === p.ccn);
if (existing) {
  if (!(existing.action === 'replace-observation' && existing.evidence_run === 'harrison-pointer-field-review-2026-09-15'
      && JSON.stringify(existing.evidence) === JSON.stringify(evidence))) throw new Error(`Existing nonmatching resolution ${p.ccn}`);
} else {
  ledger.push({ ccn: p.ccn, base: bases.get(p.ccn), action: 'replace-observation', evidence,
    evidence_run: 'harrison-pointer-field-review-2026-09-15', reviewed_at: p.observed_at, note });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: p.ccn, finding: evidence.observedFinding }, null, 2));
