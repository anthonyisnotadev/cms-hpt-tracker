'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..'), audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const records = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-reviewed-address-proof.json'), 'utf8')).records;
const expected = new Set(['100204', '234042', '340047', '351319', '400014', '400044', '420104', '470001', '501331']);
if (records.length !== 9 || records.some(p => !expected.delete(p.ccn)) || expected.size) throw new Error('Unexpected reviewed-address proof set');
for (const p of records) {
  if (p.version !== '3.0.0' || p.mrf_http_status < 200 || p.mrf_http_status >= 300 || p.retained_bytes < 65536
      || !p.pointer_sha256 || !p.mrf_sha256 || !fs.existsSync(path.join(root, p.retained_sample))) throw new Error(`Incomplete proof ${p.ccn}`);
  const evidence = { identity: 'corroborated', identity_basis: p.address_basis,
    pointerUrl: p.pointer_url, pointerSha256: p.pointer_sha256, url: p.mrf_url, finalUrl: p.mrf_final_url,
    fileSha256: p.mrf_sha256, http_status: p.mrf_http_status, checked_at: p.observed_at, date: p.declared_date,
    version: p.version, officialDomain: p.official_domain, location_name: p.pointer_location_name,
    declared_hospital_name: p.declared_hospital_name, declared_address: p.declared_address,
    declared_license_state: p.declared_state, file_kind: p.file_kind, sourcePageUrl: p.source_page_url };
  const note = `A current official identity source (${p.official_url}) reconciles the CMS roster address (${p.roster_address}, ${p.roster_city} ${p.roster_state} ${p.roster_zip}) with the pointer-linked file address (${p.declared_address}). Fresh retained CMS v3 bytes independently confirm facility identity, address and state.`;
  const existing = ledger.find(row => row.ccn === p.ccn);
  if (existing) {
    if (!(existing.action === 'replace' && existing.evidence_run === 'reviewed-address-reconciliation-2026-09-15'
      && JSON.stringify(existing.evidence) === JSON.stringify(evidence))) throw new Error(`Existing nonmatching resolution ${p.ccn}`);
  } else ledger.push({ ccn: p.ccn, base: bases.get(p.ccn), action: 'replace', evidence,
    evidence_run: 'reviewed-address-reconciliation-2026-09-15', reviewed_at: p.observed_at, note });
}
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: records.map(r => r.ccn) }, null, 2));
