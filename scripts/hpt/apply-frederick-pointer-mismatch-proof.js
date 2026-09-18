'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-frederick-pointer-mismatch-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '210005');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));

if (!base || base.finding !== 'mrf-stale-over-365-days' || proof.pointer_mrf_url === proof.current_mrf_url
    || proof.version !== '3.0.0' || proof.declared_date !== '2026-08-26' || proof.declared_state !== 'MD'
    || proof.retained_bytes !== 262144 || proof.current_mrf_transport !== 'browser-download-complete'
    || proof.current_mrf_http_status !== 200
    || !fs.existsSync(path.join(root, proof.retained_sample))) {
  throw new Error('Incomplete Frederick proof or changed base');
}

const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-page-browser-download-and-exact-name-address-state',
  pointerUrl: proof.pointer_url,
  pointerSha256: proof.pointer_sha256,
  pointerMrfUrl: proof.pointer_mrf_url,
  url: proof.current_mrf_url,
  fileSha256: proof.current_mrf_sha256,
  http_status: proof.current_mrf_http_status,
  checked_at: proof.observed_at,
  date: proof.declared_date,
  version: proof.version,
  officialDomain: proof.official_domain,
  location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_state,
  file_kind: 'csv',
  sourcePageUrl: proof.source_page_url,
  sourcePageTransport: proof.source_page_transport,
  observedFinding: 'pointer-links-older-mrf-than-source-page',
  pointerIssue: 'pointer-and-current-source-page-mrf-differ',
};
const entry = {
  ccn: '210005',
  base,
  action: 'replace-observation',
  evidence,
  evidence_run: 'frederick-page-pointer-mismatch-2026-09-16',
  reviewed_at: proof.observed_at,
  note: 'The official billing page now links a browser-downloaded CMS 3.0.0 CSV dated 2026-08-26. Its hospital name and 400 W 7th St address agree with CCN 210005. The standing retrieved root-pointer artifact links the older 2025-03-17 v2 file; live pointer retrieval was browser-blocked, so the newer file is retained without claiming that a current pointer still differs.',
};
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  const priorEvidence = { ...evidence };
  delete priorEvidence.http_status;
  const exact = JSON.stringify(old.evidence) === JSON.stringify(evidence);
  const expectedPrior = JSON.stringify(old.evidence) === JSON.stringify(priorEvidence);
  if (old.evidence_run !== entry.evidence_run || (!exact && !expectedPrior)) {
    throw new Error('Existing nonmatching Frederick resolution');
  }
  if (exact) {
    console.log('{"applied":false}');
    process.exit(0);
  }
  Object.assign(old, entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(JSON.stringify({ updated: entry.ccn, finding: evidence.observedFinding }, null, 2));
  process.exit(0);
}
ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }, null, 2));
