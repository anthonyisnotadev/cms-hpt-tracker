'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..'), audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-franciscan-nebraska-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '281322');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (!base || base.domain !== 'stmaryrehabilitationhospital.com'
    || proof.version !== '3.0.0' || proof.declared_state !== 'NE' || proof.retained_bytes < 65536
    || !fs.existsSync(path.join(root, proof.retained_sample))) throw new Error('Incomplete Franciscan correction proof or changed base');
const evidence = {
  identity: 'corroborated', identity_basis: 'exact-official-pointer-location-and-file-street-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256, url: proof.mrf_url,
  finalUrl: proof.mrf_final_url, fileSha256: proof.mrf_sha256, http_status: proof.mrf_http_status,
  checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.pointer_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
  declared_license_state: proof.declared_state, file_kind: proof.file_kind,
  sourcePageUrl: proof.official_source_page
};
const entry = { ccn: '281322', base, action: 'replace', evidence,
  evidence_run: 'franciscan-nebraska-correction-2026-09-15', reviewed_at: proof.observed_at,
  note: 'The standing assignment belonged to St Mary Rehabilitation Hospital in Pennsylvania. The current Franciscan Healthcare official page links its pricing portal, the root cms-hpt.txt names Franciscan Healthcare and the exact MRF, and retained CMS 3.0.0 bytes identify Franciscan Care Services / Franciscan Healthcare at 430 N Monitor, West Point, Nebraska with a 2026-03-18 date.' };
const existing = ledger.find(row => row.ccn === '281322');
if (existing) {
  if (!(existing.evidence_run === entry.evidence_run && JSON.stringify(existing.evidence) === JSON.stringify(evidence)))
    throw new Error('Existing nonmatching Franciscan resolution');
  console.log(JSON.stringify({ applied: false, already_present: '281322' }, null, 2));
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: '281322', corrected_unrelated_assignment: true }, null, 2));
