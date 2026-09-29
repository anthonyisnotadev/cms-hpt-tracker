'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofs = [
  'reconciliation-schleicher-county-current-mrf-proof-2026-09-24.json',
  'reconciliation-kimble-hospital-current-mrf-proof-2026-09-24.json'
].map(name => ({ name, p: JSON.parse(fs.readFileSync(path.join(audit, name), 'utf8')) }));
const compliance = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
for (const { name, p } of proofs) {
  const base = compliance.find(r => r.ccn === p.ccn) || {};
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'current-root-pointer-exact-file-full-bytes-header-name-address-state-date-version-npi-attestation',
    officialDomain: p.official_domain, sourcePageUrl: p.source_page_url, pointerUrl: p.pointer_url,
    pointerSha256: p.pointer_sha256, pointerLocationName: p.pointer_location_name,
    url: p.mrf_url, finalUrl: p.mrf_url, http_status: p.mrf_status, checked_at: p.observed_at,
    date: p.declared_last_updated, version: p.cms_template_version,
    declared_hospital_name: p.declared_hospital_name, location_name: p.declared_location_name,
    declared_address: p.declared_address, declared_license_number: p.declared_license_number,
    declared_license_state: p.declared_license_state, declared_npi: p.declared_npi,
    file_kind: p.file_kind, fileSha256: p.mrf_sha256, fullFileBytes: p.mrf_total_bytes,
    attestationPresent: p.declared_attestation, observedFinding: 'date-within-365-days-version-3'
  };
  const entry = { ccn: p.ccn, base, action: 'replace', finding: 'verified-current-mrf', evidence,
    evidence_run: `${p.ccn}-current-pointer-file-complete-review-2026-09-24`, reviewed_at: p.observed_at,
    note: `The current ${p.official_domain} root pointer links the exact first-party CSV. The complete CMS 3.0.0 file declares the facility location, address, Texas license state, NPI, attestation and 2026-02-10 update date. This is observed evidence, not a legal compliance conclusion.` };
  const index = ledger.findIndex(r => r.ccn === p.ccn);
  if (index >= 0) ledger[index] = entry; else ledger.push(entry);
  manual.records = manual.records.filter(r => r.ccn !== p.ccn);
  manual.records.push({ ...p, proof_file: name, facility_file_url: p.mrf_url, pointer_status: p.pointer_status,
    file_range_status: 'complete-200', file_sample_bytes: p.mrf_total_bytes, file_sample_sha256: p.mrf_sha256,
    declared_hospital_name: p.declared_hospital_name, declared_location_name: p.declared_location_name,
    declared_address: p.declared_address, declared_license_state: p.declared_license_state,
    declared_last_updated: p.declared_last_updated, cms_template_version: p.cms_template_version,
    attestation: p.declared_attestation, manual_identity_gate: 'recorded-file-name-street-state-agree' });
}
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: proofs.map(x => x.p.ccn), finding: 'verified-current-mrf' }, null, 2));
