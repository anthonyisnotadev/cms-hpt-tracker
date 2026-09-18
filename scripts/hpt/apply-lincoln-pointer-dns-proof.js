'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-lincoln-pointer-dns-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn);
const prior = csvToObjects(fs.readFileSync(path.join(audit,
  'rechecks/2026-09-09/recovery-856/file-evidence.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn && item.url === row.current_mrf_url
    && item.identity === 'corroborated');
const sample = fs.readFileSync(path.join(root, row.retained_sample));
if (row.ccn !== '440102' || !base || base.finding !== 'not-assessed-not-named-in-file'
    || base.domain !== 'lincolnhealthsystem.com' || !prior
    || prior.fileSha256 !== row.current_mrf_sha256
    || row.pointer_http_status !== 206 || row.pointer_mrf_http_status !== 0
    || !/resolving timed out/i.test(row.pointer_mrf_transport_error)
    || row.browser_error_code !== 'ERR_NAME_NOT_RESOLVED'
    || row.browser_target_url !== row.pointer_mrf_url
    || row.browser_observed_on !== '2026-09-16'
    || row.pointer_mrf_url === row.current_mrf_url
    || row.current_mrf_http_status !== 206 || row.retained_bytes !== 262144
    || sample.length !== row.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== row.current_mrf_sha256
    || row.declared_hospital_name !== 'HH Health System Lincoln Inc'
    || row.declared_location_name !== 'Lincoln Medical Center'
    || row.declared_address !== '106 Medical Center Blvd, Fayetteville, TN, 37334'
    || row.declared_state !== 'TN' || row.declared_date !== '2026-07-31'
    || row.version !== '3.0.0') {
  throw new Error('Incomplete Lincoln pointer DNS and page-file proof');
}
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-pricing-page-and-file-location-name-address-state',
  pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256,
  pointerHttpStatus: row.pointer_http_status,
  pointerIssue: 'pointer-file-dns-client-failure',
  pointerSourcePageUrl: row.pointer_source_page_url,
  pointerMrfUrl: row.pointer_mrf_url,
  pointerMrfHttpStatus: row.pointer_mrf_http_status,
  pointerMrfTransportError: row.pointer_mrf_transport_error,
  pointerMrfCheckedAt: row.pointer_mrf_checked_at,
  browserTargetErrorCode: row.browser_error_code,
  browserObservedOn: row.browser_observed_on,
  browserObservationMethod: row.browser_observation_method,
  url: row.current_mrf_url, fileSha256: row.current_mrf_sha256,
  http_status: row.current_mrf_http_status, checked_at: row.observed_at,
  date: row.declared_date, version: row.version, officialDomain: row.official_domain,
  location_name: row.declared_location_name,
  declared_hospital_name: row.declared_hospital_name,
  declared_address: row.declared_address,
  declared_license_state: row.declared_state, file_kind: 'csv',
  sourcePageUrl: row.source_page_url, sourcePageSha256: row.source_page_sha256,
  observedFinding: 'pointer-target-dns-unresolved-page-file-found',
  next_action: row.next_action,
};
const entry = { ccn: row.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'lincoln-pointer-dns-current-page-file-2026-09-16-440102',
  reviewed_at: row.observed_at,
  note: 'The first-party plain-text root pointer names Lincoln Medical Center but directs its source page and CSV to hhlincolnhealth.org. The exact file hostname timed out during DNS resolution in the bounded client, and a separate browser direct navigation reported ERR_NAME_NOT_RESOLVED. The current Lincoln Health System pricing page links the same-basename CSV on lincolnhealthsystem.com. A retained bounded sample agrees with Lincoln Medical Center, its Fayetteville campus and Tennessee license state, dated 2026-07-31 on CMS 3.0.0. DNS failures are client observations, not proof of file absence or noncompliance; the current page-linked CSV is not called pointer-linked.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(item => item.ccn === row.ccn);
if (old && (old.evidence_run !== entry.evidence_run
    || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
  throw new Error('Existing nonmatching Lincoln resolution');
}
if (!old) {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: !old, ccn: row.ccn }));
