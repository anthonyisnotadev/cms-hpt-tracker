'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-wth-page-file-proofs.json'), 'utf8'));
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const expected = new Set(['440002', '441316', '441320']);
if (proof.records.length !== expected.size || new Set(proof.records.map(row => row.ccn)).size !== expected.size) {
  throw new Error('Unexpected WTH proof cohort');
}
const entries = proof.records.map(row => {
  const base = bases.get(row.ccn);
  const sample = fs.readFileSync(path.join(root, row.retained_sample));
  if (!expected.has(row.ccn) || !base || base.finding !== 'no-cms-hpt-txt-published'
      || base.domain !== 'wth.org' || row.official_domain !== 'wth.org'
      || row.pointer_url !== 'https://www.wth.org/cms-hpt.txt' || row.pointer_http_status !== 404
      || row.current_mrf_http_status !== 206 || row.retained_bytes !== 262144
      || sample.length !== row.retained_bytes
      || crypto.createHash('sha256').update(sample).digest('hex') !== row.current_mrf_sha256
      || row.declared_state !== 'TN' || row.version !== '3.0.0'
      || row.declared_hospital_name !== row.declared_location_name) {
    throw new Error(`Incomplete or mismatched WTH proof for ${row.ccn}`);
  }
  const evidence = {
    identity: 'corroborated', identity_basis: 'official-facility-page-pricing-page-and-file-header-exact-name-street-city-state',
    pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256,
    pointerHttpStatus: row.pointer_http_status,
    url: row.current_mrf_url, fileSha256: row.current_mrf_sha256,
    http_status: row.current_mrf_http_status, checked_at: row.observed_at,
    date: row.declared_date, version: row.version,
    officialDomain: row.official_domain, location_name: row.declared_location_name,
    declared_hospital_name: row.declared_hospital_name, declared_address: row.declared_address,
    declared_license_state: row.declared_state, file_kind: 'csv',
    sourcePageUrl: row.source_page_url, sourcePageSha256: row.source_page_sha256,
    officialIdentityUrl: row.official_identity_url, officialIdentitySha256: row.official_identity_sha256,
    observedFinding: 'official-page-mrf-root-pointer-unavailable', pointerIssue: 'root-pointer-http-error',
    next_action: row.next_action,
  };
  return { ccn: row.ccn, base, action: 'replace-observation', evidence,
    evidence_run: `wth-page-file-root-pointer-2026-09-16-${row.ccn}`, reviewed_at: row.observed_at,
    note: `West Tennessee Healthcare's current first-party pricing page separately labels the ${row.declared_hospital_name} CSV. Its facility page and retained file header agree on ${row.declared_address}; the file declares Tennessee, ${row.declared_date}, and CMS ${row.version}. The current system root cms-hpt.txt returned HTTP 404, so this is page-linked file evidence, not pointer-linked or a compliance conclusion.` };
});
for (const entry of entries) {
  const old = ledger.find(row => row.ccn === entry.ccn);
  if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
    throw new Error(`Existing nonmatching WTH resolution ${entry.ccn}`);
  }
}
const additions = entries.filter(entry => !ledger.some(row => row.ccn === entry.ccn));
if (additions.length) {
  ledger.push(...additions); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: additions.map(row => row.ccn), already_present: entries.length - additions.length }));
