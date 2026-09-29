'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-andalusia-health-current-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
if (!base || proof.cms_template_version !== '3.0.0' || proof.declared_license_state !== base.state || proof.full_file_bytes < 65536) throw new Error('Incomplete Andalusia proof or changed base');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const evidence = {
  identity: 'corroborated', identity_basis: 'exact-pointer-and-file-header-name-address-state-date-and-cms-version',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256, url: proof.mrf_url, fileSha256: proof.mrf_sha256,
  http_status: proof.response_status, checked_at: proof.observed_at, date: proof.declared_last_updated, version: proof.cms_template_version,
  officialDomain: proof.official_domain, location_name: proof.declared_location_name, declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_license_state, file_kind: 'json',
  sourcePageUrl: proof.pointer_url, observedFinding: 'compliant-observed', fullFileBytes: proof.full_file_bytes
};
const entry = { ccn: proof.ccn, base, action: 'replace', evidence, evidence_run: 'andalusia-health-current-pointer-file-2026-09-17', reviewed_at: proof.observed_at,
  note: 'The exact Andalusia Health root pointer and pointer-linked JSON MRF identify the facility at 849 South Three Notch Street, Andalusia AL, dated 2026-04-01 with CMS 3.0.0. Identity/current metadata are corroborated; no rate-line or legal compliance conclusion is inferred.' };
const existing = ledger.find(row => row.ccn === proof.ccn);
if (existing) {
  const sameEvidence = existing.evidence && existing.evidence.pointerSha256 === evidence.pointerSha256
    && existing.evidence.fileSha256 === evidence.fileSha256 && existing.evidence.date === evidence.date;
  if (!sameEvidence) throw new Error('Existing nonmatching Andalusia resolution');
  console.log(JSON.stringify({ applied:false, already_present:proof.ccn },null,2)); process.exit(0);
}
ledger.push(entry); ledger.sort((a,b)=>a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger,null,2)+'\n');
console.log(JSON.stringify({ applied: proof.ccn, finding: evidence.observedFinding },null,2));
