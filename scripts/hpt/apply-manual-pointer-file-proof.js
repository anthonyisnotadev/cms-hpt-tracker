'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const compliance = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const proof = new Map(JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-manual-pointer-file-proof.json'), 'utf8')).records.map(row => [row.ccn, row]));
const nationwide = new Map(JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8')).records.map(row => [row.ccn, row]));
const ccn = '010045', row = proof.get(ccn), report = nationwide.get(ccn);
if (!row || row.http_status !== 200 || !row.payload_sha256 || row.metadata?.hospital_name !== 'Fayette Medical Center'
    || row.metadata?.license_state !== 'AL' || row.metadata?.date !== '2026-03-26' || row.metadata?.version !== '3.0.0'
    || !report?.evidence?.pointer_sha256s?.length || report.mrf_url !== row.source_url)
  throw new Error('Incomplete Fayette pointer/file proof');
const evidence = { identity: 'corroborated', identity_basis: 'official-pointer-file-and-reviewed-address-equivalence',
  pointerUrl: 'https://www.dchsystem.com/cms-hpt.txt', pointerSha256: report.evidence.pointer_sha256s[0],
  url: row.source_url, fileSha256: row.sha256, payloadSha256: row.payload_sha256,
  http_status: row.http_status, checked_at: row.observed_at, date: row.metadata.date, version: row.metadata.version,
  officialDomain: 'dchsystem.com', location_name: row.metadata.location_name, file_kind: row.payload_kind,
  sourcePageUrl: 'https://www.dchsystem.com/locations/fayette-medical-center/',
  declared_hospital_name: row.metadata.hospital_name, declared_address: row.metadata.address,
  declared_license_state: row.metadata.license_state, address_equivalence_ccn: ccn };
const note = 'Fresh bounded MRF bytes and the exact official pointer entry identify Fayette Medical Center. DCH’s official facility page corroborates the file’s 1653 Temple Avenue address; the roster’s added North directional is retained as a reviewed address equivalence.';
const existing = ledger.find(item => item.ccn === ccn);
if (existing) {
  if (!(existing.action === 'replace' && existing.evidence_run === 'manual-pointer-file-byte-review-2026-09-15'
      && JSON.stringify(existing.evidence) === JSON.stringify(evidence))) throw new Error(`Existing nonmatching resolution ${ccn}`);
} else {
  ledger.push({ ccn, base: compliance.get(ccn), action: 'replace', evidence,
    evidence_run: 'manual-pointer-file-byte-review-2026-09-15', reviewed_at: row.observed_at, note });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: ccn }, null, 2));

{
  const ccn = '210065', row = proof.get(ccn);
  if (!row || row.http_status !== 206 || !row.payload_sha256 || row.metadata?.hospital_name !== 'Holy Cross Germantown Hospital'
      || row.metadata?.license_state !== 'MD' || row.metadata?.date !== '2026-03-31' || row.metadata?.version !== '3.0.0')
    throw new Error('Incomplete Holy Cross Germantown file proof');
  const evidence = { identity: 'corroborated', identity_basis: 'official-pointer-location-and-file-street-state',
    pointerUrl: 'https://www.holycrosshealth.org/sites/default/files/price-transparency/cms-hpt.txt',
    pointerSha256: '456139419b94ac121b00387e2cf6c71751d44bfd78dbec6815fbecce8c9b01c3',
    pointerIssue: 'misspelled-mfr-url', observedFinding: 'pointer-lists-no-mrf-url',
    url: row.source_url, fileSha256: row.sha256, payloadSha256: row.payload_sha256,
    http_status: row.http_status, checked_at: row.observed_at, date: row.metadata.date, version: row.metadata.version,
    officialDomain: 'holycrosshealth.org', location_name: row.metadata.location_name, file_kind: row.payload_kind,
    sourcePageUrl: 'https://www.holycrosshealth.org/for-patients/billing-financial-assistance-and-insurance/charge-estimates',
    declared_hospital_name: row.metadata.hospital_name, declared_address: row.metadata.address,
    declared_license_state: row.metadata.license_state };
  const note = 'The fresh official pointer has a Germantown-specific entry and exact file URL, but publishes it under the misspelled field mfr-url rather than mrf-url. Fresh bounded ZIP/CSV bytes corroborate the Germantown facility, address, state, date and version. Retain the usable file while recording the factual pointer-field defect.';
  const existing = ledger.find(item => item.ccn === ccn);
  if (existing) {
    if (!(existing.action === 'replace-observation' && existing.evidence_run === 'holy-cross-pointer-typo-review-2026-09-15'
        && JSON.stringify(existing.evidence) === JSON.stringify(evidence))) throw new Error(`Existing nonmatching resolution ${ccn}`);
  } else {
    ledger.push({ ccn, base: compliance.get(ccn), action: 'replace-observation', evidence,
      evidence_run: 'holy-cross-pointer-typo-review-2026-09-15', reviewed_at: row.observed_at, note });
    ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied_observation: ccn, finding: evidence.observedFinding }, null, 2));
}
