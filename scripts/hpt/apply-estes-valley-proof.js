'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { record: row } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-estes-valley-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(item => item.ccn === row.ccn);
const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
  .find(item => item.ccn === row.ccn);
const sample = fs.readFileSync(path.join(root, row.retained_sample));
if (row.ccn !== '061312' || !base || base.finding !== 'no-cms-hpt-txt-published'
    || base.domain !== 'search.hospitalpriceindex.com' || base.mrf_url
    || !roster || roster.address !== '555 PROSPECT AVE'
    || roster.city !== 'ESTES PARK' || roster.state !== 'CO' || roster.zip !== '80517'
    || row.official_domain !== 'uchealth.org'
    || row.pointer_http_status !== 200 || row.mrf_http_status !== 206
    || row.pointer_url !== 'https://www.uchealth.org/cms-hpt.txt'
    || row.mrf_url !== 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8187/393395823_uchealth-estes-valley-medical-center_standardcharges.csv'
    || row.retained_bytes !== 262144 || sample.length !== 262144
    || crypto.createHash('sha256').update(sample).digest('hex') !== row.mrf_sample_sha256
    || row.declared_hospital_name !== 'UCHealth Estes Valley Medical Center'
    || !row.declared_location_name.split('|').every(name => name.trim() === 'UCHealth Estes Valley Medical Center')
    || !row.declared_address.split('|').every(address => address === '555 Prospect Avenue, Estes Park, CO 80517')
    || row.declared_state !== 'CO' || row.declared_date !== '2025-11-01'
    || row.version !== '3.0.0') {
  throw new Error('Incomplete Estes Valley pointer/file proof');
}
const evidence = {
  identity: 'corroborated',
  identity_basis: 'uchealth-current-estes-valley-location-and-pricing-page-exact-root-pointer-file-header',
  pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256,
  pointerHttpStatus: row.pointer_http_status,
  url: row.mrf_url, fileSha256: row.mrf_sample_sha256,
  http_status: row.mrf_http_status, checked_at: row.observed_at,
  date: row.declared_date, version: row.version, officialDomain: row.official_domain,
  location_name: row.pointer_location_name,
  declared_hospital_name: row.declared_hospital_name,
  declared_address: row.declared_address,
  declared_license_state: row.declared_state,
  file_kind: 'csv', sourcePageUrl: row.official_pricing_page_url,
  sourcePageSha256: row.official_pricing_page_sha256,
  officialIdentityUrl: row.official_identity_url,
  officialIdentitySha256: row.official_identity_sha256,
  next_action: row.next_action,
};
const entry = { ccn: row.ccn, base, action: 'replace', evidence,
  evidence_run: 'uchealth-estes-valley-direct-pointer-file-2026-09-16-061312',
  reviewed_at: row.observed_at,
  note: 'The prior crawl treated Hospital Price Index, the vendor, as the official hospital domain. Current UCHealth identifies Estes Valley Medical Center at 555 Prospect Avenue, Estes Park CO 80517; its pricing page links the exact CSV named by its root cms-hpt.txt. The retained 262,144-byte CSV header declares UCHealth Estes Valley Medical Center, the same address, Colorado license state, 2025-11-01 and CMS 3.0.0. The roster uses the historical Estes Park Medical Center name at the same exact campus. This is bounded pointer/header verification, not full-file validation or a legal conclusion.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(item => item.ccn === row.ccn);
if (old && (old.evidence_run !== entry.evidence_run
    || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
  throw new Error('Existing nonmatching Estes Valley resolution');
}
if (!old) {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: !old, ccn: row.ccn }));
