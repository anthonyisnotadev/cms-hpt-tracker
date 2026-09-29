'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const records = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-winchester-wadley-proof.json'), 'utf8')).records;
const expected = new Set(['440058', '450200']);
if (records.length !== 2 || records.some(p => !expected.delete(p.ccn)) || expected.size) throw new Error('Expected Winchester and Wadley proof records');

for (const p of records) {
  if (p.version !== '3.0.0' || p.mrf_http_status < 200 || p.mrf_http_status >= 300 || !p.pointer_sha256 || !p.mrf_sha256
      || !p.pointer_mrf_url || !p.mrf_final_url || p.retained_bytes < 65536 || !fs.existsSync(path.join(root, p.retained_sample))) {
    throw new Error(`Incomplete retained proof ${p.ccn}`);
  }
  const identityBasis = p.ccn === '440058'
    ? 'first-party-documented-rename-exact-address-pointer-and-retained-file-metadata'
    : 'first-party-documented-acquisition-and-rename-exact-address-pointer-and-retained-file-metadata';
  const evidence = {
    identity: 'corroborated', identity_basis: identityBasis,
    pointerUrl: p.pointer_url, pointerSha256: p.pointer_sha256,
    url: p.pointer_mrf_url, finalUrl: p.mrf_final_url, fileSha256: p.mrf_sha256,
    http_status: p.mrf_http_status, checked_at: p.observed_at, date: p.declared_date, version: p.version,
    officialDomain: p.official_domain, location_name: p.pointer_location_name,
    declared_hospital_name: p.declared_hospital_name, declared_address: p.declared_address,
    declared_license_state: p.declared_state, file_kind: p.file_kind, sourcePageUrl: p.source_page_url
  };
  const note = p.ccn === '440058'
    ? 'The current first-party Winchester page documents that Highpoint Health - Winchester was formerly Southern Tennessee Regional Health System - Winchester. The official pointer entry and retained current CMS v3 CSV metadata include the exact 185 Hospital Road Winchester address and Tennessee state.'
    : 'CHRISTUS documents its acquisition of Wadley Regional Medical Center and the current Pine Street name. The official pointer entry and retained current CMS v3 JSON metadata include the exact 1000 Pine Street Texarkana address and Texas state.';
  const existing = ledger.find(row => row.ccn === p.ccn);
  if (existing) {
    if (!(existing.action === 'replace' && existing.evidence_run === 'winchester-wadley-identity-transition-2026-09-15'
        && JSON.stringify(existing.evidence) === JSON.stringify(evidence))) throw new Error(`Existing nonmatching resolution ${p.ccn}`);
  } else {
    const base = bases.get(p.ccn);
    if (!base) throw new Error(`Missing compliance base ${p.ccn}`);
    ledger.push({ ccn: p.ccn, base, action: 'replace', evidence,
      evidence_run: 'winchester-wadley-identity-transition-2026-09-15', reviewed_at: p.observed_at, note });
  }
}
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: records.map(p => p.ccn) }, null, 2));
