'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { records } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-blythedale-williamson-pointer-mismatch-proofs.json'), 'utf8'));
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .map(row => [row.ccn, row]));
const recovery = csvToObjects(fs.readFileSync(path.join(audit,
  'rechecks/2026-09-09/recovery-856/file-evidence.csv'), 'utf8'));
const expected = new Map([
  ['333301', { domain: 'blythedale.org', state: 'NY', date: '2026-03-01', bytes: 32927 }],
  ['440029', { domain: 'williamsonhealth.org', state: 'TN', date: '2026-08-01', bytes: 262144 }],
]);
if (records.length !== expected.size || new Set(records.map(row => row.ccn)).size !== expected.size) {
  throw new Error('Unexpected Blythedale/Williamson proof cohort');
}
const entries = records.map(row => {
  const want = expected.get(row.ccn);
  const base = bases.get(row.ccn);
  const prior = recovery.find(item => item.ccn === row.ccn && item.url === row.current_mrf_url
    && item.identity === 'corroborated');
  const sample = fs.readFileSync(path.join(root, row.retained_sample));
  if (!want || !base || base.finding !== 'mrf-url-unreachable' || base.domain !== want.domain
      || !prior || prior.fileSha256 !== row.current_mrf_sha256
      || row.pointer_mrf_http_status !== 404 || row.current_mrf_http_status !== 206
      || row.pointer_mrf_url === row.current_mrf_url || row.retained_bytes !== want.bytes
      || sample.length !== row.retained_bytes
      || crypto.createHash('sha256').update(sample).digest('hex') !== row.current_mrf_sha256
      || row.declared_state !== want.state || row.declared_date !== want.date
      || row.version !== '3.0.0') throw new Error(`Incomplete current proof for ${row.ccn}`);
  const evidence = {
    identity: 'corroborated', identity_basis: 'official-pricing-page-and-file-header-name-address-state',
    pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256,
    pointerHttpStatus: row.pointer_http_status, pointerMrfUrl: row.pointer_mrf_url,
    pointerMrfHttpStatus: row.pointer_mrf_http_status,
    url: row.current_mrf_final_url, sourcePageMrfUrl: row.current_mrf_url,
    fileSha256: row.current_mrf_sha256, http_status: row.current_mrf_http_status,
    checked_at: row.observed_at, date: row.declared_date, version: row.version,
    officialDomain: row.official_domain, location_name: row.declared_location_name,
    declared_hospital_name: row.declared_hospital_name, declared_address: row.declared_address,
    declared_license_state: row.declared_state, file_kind: 'csv',
    sourcePageUrl: row.source_page_url, sourcePageSha256: row.source_page_sha256,
    ...(row.page_updated_claim ? { sourcePageUpdateClaim: row.page_updated_claim } : {}),
    observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
    pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: row.next_action,
  };
  return { ccn: row.ccn, base, action: 'replace-observation', evidence,
    evidence_run: `blythedale-williamson-pointer-mismatch-2026-09-16-${row.ccn}`,
    reviewed_at: row.observed_at,
    note: `The current plain-text root pointer names a CSV URL returning HTTP 404. The first-party pricing page separately links a different CSV whose bounded header identifies ${row.declared_location_name} at ${row.declared_address}, ${row.declared_state} license state, ${row.declared_date} update date and CMS ${row.version}.${row.page_updated_claim ? ' The page also says all files were updated on 3/31/2026, which differs from the file-declared 2026-03-01 date and remains a distinct publisher statement.' : ''}${row.current_mrf_url !== row.current_mrf_final_url ? ' The page HTTP link redirects to the HTTPS file URL retained for the tracker.' : ''} This is a current page-linked file, not a working pointer-linked file or compliance conclusion.` };
});
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
for (const entry of entries) {
  const old = ledger.find(item => item.ccn === entry.ccn);
  if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
    throw new Error(`Existing nonmatching resolution ${entry.ccn}`);
  }
}
const additions = entries.filter(entry => !ledger.some(item => item.ccn === entry.ccn));
if (additions.length) {
  ledger.push(...additions); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: additions.map(row => row.ccn), already_present: entries.length - additions.length }));
