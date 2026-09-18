'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..'), audit = path.join(root, 'data/hpt-audit');
const proofs = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-ardent-license-state-proofs.json'), 'utf8')).records;
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const ledgerPath = path.join(audit, 'reviewed-resolutions.json'), ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const applied = [];
for (const proof of proofs) {
  const base = bases.get(proof.ccn);
  if (!base || base.finding !== 'compliant-observed' || proof.declared_license_state !== 'CA'
      || proof.declared_license_state === proof.facility_state || proof.version !== '3.0.0'
      || proof.retained_bytes < 65536 || !fs.existsSync(path.join(root, proof.retained_sample))) throw new Error(`Incomplete ${proof.ccn} proof or changed base`);
  const evidence = { identity: 'corroborated', identity_basis: 'exact-root-pointer-file-name-address-state-and-official-page-with-conflicting-license-state-column',
    pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256, url: proof.mrf_url, finalUrl: proof.mrf_final_url,
    fileSha256: proof.mrf_sample_sha256, http_status: proof.mrf_http_status, checked_at: proof.observed_at,
    date: proof.declared_date, version: proof.version, officialDomain: new URL(proof.pointer_url).hostname,
    location_name: proof.declared_location_name, declared_hospital_name: proof.declared_hospital_name,
    declared_address: proof.declared_address, declared_license_state: proof.declared_license_state,
    facility_state: proof.facility_state, file_kind: 'csv', identityPageUrl: proof.identity_page_url,
    identityPageSha256: proof.identity_page_sha256, observedFinding: 'mrf-license-state-field-conflicts-facility' };
  const entry = { ccn: proof.ccn, base, action: 'replace-observation', evidence,
    evidence_run: 'ardent-license-state-conflict-2026-09-15', reviewed_at: proof.observed_at,
    note: `The current root pointer, current Ardent CSV and current first-party facility page independently identify ${proof.declared_hospital_name} at ${proof.declared_address}. The CSV nevertheless labels its license-number column license_number|CA while the facility state is ${proof.facility_state}. This explicit current publisher-field conflict supersedes the older generic compliant observation without treating CA as equivalent to the facility state or making a legal compliance determination.` };
  const old = ledger.find(row => row.ccn === entry.ccn);
  if (old) { if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) throw new Error(`Existing nonmatching ${proof.ccn} resolution`); continue; }
  ledger.push(entry); applied.push(proof.ccn);
}
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn)); fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied }, null, 2));
