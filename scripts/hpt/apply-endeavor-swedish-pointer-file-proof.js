'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-endeavor-swedish-pointer-file-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn);
const prior = csvToObjects(fs.readFileSync(path.join(audit,
  'rechecks/2026-09-09/recovery-856/file-evidence.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn && item.url === row.mrf_url
    && item.identity === 'corroborated');
const sample = fs.readFileSync(path.join(root, row.retained_sample));
if (row.ccn !== '140114' || !base || base.finding !== 'pointer-blocked-to-automation'
    || base.domain !== 'swedishcovenant.org' || !prior
    || prior.fileSha256 !== row.mrf_sha256
    || row.old_pointer_final_url !== 'https://www.endeavorhealth.org/'
    || !String(row.old_pointer_content_type).startsWith('text/html')
    || row.pointer_http_status !== 206 || row.mrf_http_status !== 200
    || row.retained_bytes !== 262144 || sample.length !== row.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== row.mrf_sha256
    || row.declared_hospital_name !== 'Swedish Covenant Health'
    || row.declared_location_name !== 'Endeavor Health Swedish Hospital'
    || row.declared_address !== '5145 N California Ave, Chicago, IL 60625'
    || row.declared_state !== 'IL' || row.declared_date !== '2026-04-01'
    || row.version !== '3.0.0') {
  throw new Error('Incomplete Endeavor Swedish pointer/file proof');
}
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-endeavor-location-page-exact-campus-and-mrf-location-name-address-state',
  pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256,
  pointerHttpStatus: row.pointer_http_status,
  oldPointerUrl: row.old_pointer_url,
  oldPointerFinalUrl: row.old_pointer_final_url,
  oldPointerContentType: row.old_pointer_content_type,
  oldPointerResponseSha256: row.old_pointer_response_sha256,
  url: row.mrf_url, fileSha256: row.mrf_sha256,
  http_status: row.mrf_http_status, checked_at: row.observed_at,
  date: row.declared_date, version: row.version, officialDomain: row.official_domain,
  location_name: row.declared_location_name,
  declared_hospital_name: row.declared_hospital_name,
  declared_address: row.declared_address,
  declared_license_state: row.declared_state, file_kind: 'json',
  sourcePageUrl: row.source_page_url, sourcePageSha256: row.source_page_sha256,
  officialIdentityUrl: row.official_identity_url,
  officialIdentitySha256: row.official_identity_sha256,
  next_action: row.next_action,
};
const entry = { ccn: row.ccn, base, action: 'replace', evidence,
  evidence_run: 'endeavor-swedish-current-pointer-file-domain-move-2026-09-16-140114',
  reviewed_at: row.observed_at,
  note: 'The earlier Swedish Covenant root-path check was blocked in the crawl, but a current bounded request redirects that path to the Endeavor homepage, not a pointer. Endeavor Health identifies Swedish Hospital at 5145 N California Ave, Chicago; its plain-text root pointer specifically names Endeavor Health Swedish Hospital and directly links the same JSON shown on its pricing page. A fresh bounded sample identifies Swedish Covenant Health / Endeavor Health Swedish Hospital at that campus, Illinois license state, 2026-04-01 and CMS 3.0.0. This is a supported pointer-linked current observation, not full-file validation.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(item => item.ccn === row.ccn);
if (old && (old.evidence_run !== entry.evidence_run
    || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
  throw new Error('Existing nonmatching Endeavor Swedish resolution');
}
if (!old) {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: !old, ccn: row.ccn }));
