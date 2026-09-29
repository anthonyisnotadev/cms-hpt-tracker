'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-small-archive-dispositions.json'), 'utf8')).records.find(row => row.ccn === '450465');
const capture = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-small-unmatched-archives.json'), 'utf8')).records.find(row => row.ccn === '450465');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '450465');
if (!proof || !capture?.complete || capture.sha256 !== proof.sha256 || proof.version !== '3.0.0'
    || !fs.existsSync(path.join(root, capture.raw_artifact))) throw new Error('Incomplete Matagorda archive proof');
const evidence = {
  identity: 'corroborated', identity_basis: 'exact-official-pointer-complete-archive-member-name-address-state',
  pointerUrl: 'https://matagordaregional.org/cms-hpt.txt', pointerSha256: '57319c1c883ccbc7f8c03a519d3a6eeb7a6de59baad70680b295a85c09034afe',
  url: capture.url, fileSha256: proof.sha256, decompressedSha256: proof.member_sha256,
  http_status: capture.http_status, checked_at: capture.checked_at, date: proof.date, version: proof.version,
  officialDomain: 'matagordaregional.org', location_name: 'Matagorda Regional Medical Center',
  declared_hospital_name: 'Matagorda County Hospital District', declared_address: '104 Seventh Street Bay City, TX 77414',
  declared_license_state: 'TX', file_kind: 'csv.zip', sourcePageUrl: 'https://www.matagordaregional.org/price-transparency/'
};
const note = 'The exact current official pointer names Matagorda Regional Medical Center and links the retained complete archive. Its 52,270,186-byte CSV member declares Matagorda County Hospital District at 104 Seventh Street, Bay City TX 77414 with Texas license state, a 2026-01-23 date and CMS version 3.0.0, matching the CMS roster location.';
const existing = ledger.find(row => row.ccn === '450465');
if (existing) {
  const existingEvidence = existing.evidence || {};
  const equivalentReviewedOutcome = existing.action === 'replace'
    && existingEvidence.identity === 'corroborated'
    && existingEvidence.version === proof.version
    && existingEvidence.date === proof.date
    && existingEvidence.pointerUrl === evidence.pointerUrl
    && existingEvidence.url === evidence.url
    && existingEvidence.header_address === evidence.declared_address
    && existingEvidence.header_state === evidence.declared_license_state;
  if (!equivalentReviewedOutcome) throw new Error('Existing Matagorda resolution is not equivalent to the complete-archive proof');
  if (existing.evidence_run === 'matagorda-complete-archive-2026-09-15'
      && existingEvidence.archiveSha256 === proof.sha256
      && existingEvidence.decompressedSha256 === proof.member_sha256) {
    console.log(JSON.stringify({ applied: false, corroborated: '450465', reason: 'complete-archive corroboration already recorded' }, null, 2));
    process.exit(0);
  }
  existing.evidence = { ...existingEvidence,
    checked_at: capture.checked_at,
    http_status: capture.http_status,
    archiveSha256: proof.sha256,
    decompressedSha256: proof.member_sha256,
    archive_bytes: capture.bytes_retained,
    member: proof.member,
    member_bytes: proof.member_bytes,
    transport: 'complete-object-capture'
  };
  existing.evidence_run = 'matagorda-complete-archive-2026-09-15';
  existing.reviewed_at = capture.checked_at;
  existing.note = note + ' This refresh corroborates the existing reviewed outcome; it does not change the tracker finding.';
} else ledger.push({ ccn: '450465', base, action: 'replace', evidence,
  evidence_run: 'matagorda-complete-archive-2026-09-15', reviewed_at: capture.checked_at, note });
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied: '450465', corroborated: true, finding_changed: false }, null, 2));
