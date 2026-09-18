'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-byte-metadata-updates.json'), 'utf8')).records;
for (const p of proof) {
  const raw = path.resolve(root, p.raw_artifact);
  if (!raw.startsWith(root + path.sep) || !fs.existsSync(raw)) throw new Error(`Missing safe raw proof ${p.ccn}`);
  const bytes = fs.readFileSync(raw);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== p.bytes_retained || digest !== p.sha256 || p.declared_license_state !== bases.get(p.ccn)?.state
      || p.version !== '3.0.0' || !/^2026-/.test(p.declared_date) || p.http_status < 200 || p.http_status >= 300)
    throw new Error(`Incomplete or inconsistent byte proof ${p.ccn}`);
  const evidence = { identity: 'corroborated', identity_basis: 'current-pointer-and-retained-bounded-root-metadata-bytes',
    pointerUrl: p.pointer_url, pointerSha256: p.pointer_sha256, url: p.mrf_url, fileSha256: p.sha256,
    bytesRetained: p.bytes_retained, requestedRange: p.requested_range, http_status: p.http_status,
    checked_at: p.observed_at, date: p.declared_date, version: p.version, officialDomain: p.official_domain,
    location_name: p.declared_location_name, declared_hospital_name: p.declared_hospital_name,
    declared_address: p.declared_address, declared_license_state: p.declared_license_state, file_kind: p.file_kind };
  const note = `Fresh retained bytes from the exact pointer-linked file reproduce current root identity and metadata: ${p.declared_hospital_name}, ${p.declared_address}, ${p.declared_date}, CMS ${p.version}. Earlier metadata remains in history.`;
  const existing = ledger.find(row => row.ccn === p.ccn);
  if (existing) {
    if (!(existing.action === 'replace' && existing.evidence_run === 'nationwide-byte-metadata-refresh-2026-09-15'
        && JSON.stringify(existing.evidence) === JSON.stringify(evidence))) throw new Error(`Existing nonmatching resolution ${p.ccn}`);
  } else ledger.push({ ccn: p.ccn, base: bases.get(p.ccn), action: 'replace', evidence,
    evidence_run: 'nationwide-byte-metadata-refresh-2026-09-15', reviewed_at: p.observed_at, note });
}
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: proof.map(record => record.ccn) }, null, 2));
