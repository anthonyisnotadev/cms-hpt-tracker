'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-crestwood-dns-override-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn);
const sample = fs.readFileSync(path.join(root, row.retained_sample));
if (row.ccn !== '010131' || !base || base.finding !== 'not-assessed-site-unreachable'
    || base.domain !== 'crestwoodmedcenter.com' || base.mrf_url
    || row.pointer_http_status !== 206 || row.mrf_http_status !== 206
    || row.pointer_url !== 'https://crestwoodmedcenter.com/cms-hpt.txt'
    || row.mrf_url !== 'https://crestwoodmedcenter.com/wp-content/uploads/621647983_crestwood-medical-center_standardcharges.csv'
    || row.retained_bytes !== 262144 || sample.length !== 262144
    || crypto.createHash('sha256').update(sample).digest('hex') !== row.mrf_sample_sha256
    || row.declared_hospital_name !== 'Crestwood Medical Center'
    || row.declared_location_name !== 'Crestwood Medical Center'
    || row.declared_address !== 'One Hospital Drive, Huntsville, AL 35801'
    || row.declared_state !== 'AL' || row.declared_date !== '2026-01-01'
    || row.version !== '3.0.0') {
  throw new Error('Incomplete Crestwood DNS-override pointer/file proof');
}
const evidence = {
  identity: 'corroborated',
  identity_basis: 'official-crestwood-site-exact-huntsville-address-and-direct-pointer-linked-file-header',
  dnsOverrideIp: row.dns_override_ip,
  dnsOverrideReason: row.dns_override_reason,
  pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256,
  pointerHttpStatus: row.pointer_http_status,
  url: row.mrf_url, fileSha256: row.mrf_sample_sha256,
  http_status: row.mrf_http_status, checked_at: row.observed_at,
  date: row.declared_date, version: row.version, officialDomain: row.official_domain,
  location_name: row.declared_location_name,
  declared_hospital_name: row.declared_hospital_name,
  declared_address: row.declared_address,
  declared_license_state: row.declared_state,
  file_kind: 'csv', sourcePageUrl: row.source_page_url,
  sourcePageSha256: row.source_page_sha256,
  officialIdentityUrl: row.official_identity_url,
  officialIdentitySha256: row.official_identity_sha256,
  next_action: row.next_action,
};
const entry = { ccn: row.ccn, base, action: 'replace', evidence,
  evidence_run: 'crestwood-dns-override-direct-pointer-file-2026-09-16-010131',
  reviewed_at: row.observed_at,
  note: 'The earlier client could not resolve the official domain. A dated Google DNS A response supplied the current address and curl --resolve retained the exact hospital hostname/TLS while retrieving the root pointer and its declared CSV. The first-party pricing page links that same file, and the first-party contact page identifies One Hospital Drive, Huntsville. A retained 262,144-byte CSV header declares Crestwood Medical Center at that address, Alabama license state, 2026-01-01 and CMS 3.0.0. This is bounded pointer/header verification, not full-file validation.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(item => item.ccn === row.ccn);
if (old && (old.evidence_run !== entry.evidence_run
    || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
  throw new Error('Existing nonmatching Crestwood resolution');
}
if (!old) {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: !old, ccn: row.ccn }));
