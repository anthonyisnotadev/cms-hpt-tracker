'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-reno-pointer-omission-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === '294015');
const file = fs.readFileSync(path.join(root, proof.retained_file));
if (proof.ccn !== '294015' || !base || base.finding !== 'not-assessed-not-named-in-file'
    || base.domain !== 'renobehavioral.com'
    || proof.roster_name !== 'RENO BEHAVIORAL HEALTHCARE HOSPITAL, LLC'
    || proof.roster_address !== '6940 SIERRA CENTER PKWY' || proof.roster_city !== 'RENO'
    || proof.roster_state !== 'NV' || proof.roster_zip !== '89511'
    || proof.official_domain !== 'renobehavioral.com'
    || proof.contact_url !== 'https://www.renobehavioral.com/contact'
    || !/^[a-f0-9]{64}$/.test(proof.contact_sha256)
    || proof.source_page_url !== 'https://www.renobehavioral.com/resources'
    || !/^[a-f0-9]{64}$/.test(proof.source_page_sha256)
    || proof.pointer_url !== 'https://renobehavioral.com/cms-hpt.txt'
    || proof.pointer_http_status !== 206 || proof.pointer_bytes !== 3192
    || !/^[a-f0-9]{64}$/.test(proof.pointer_sha256)
    || proof.pointer_lists_reno !== false || proof.pointer_lists_page_file !== false
    || proof.pointer_location_names.length !== 10
    || proof.pointer_location_names.some(name => /Reno/i.test(name))
    || proof.page_mrf_url !== 'https://www.renobehavioral.com/sites/default/files/reno/CMS%20Machine%20Readable%20HOS%208.2026.csv'
    || proof.page_mrf_http_status !== 206 || proof.page_mrf_bytes !== 15465
    || proof.page_mrf_total_bytes !== 15465 || file.length !== 15465
    || crypto.createHash('sha256').update(file).digest('hex') !== proof.page_mrf_sha256
    || proof.page_mrf_parsed_rows !== 60
    || proof.declared_hospital_name !== 'Reno Behavioral healthcare Hospital, LLC'
    || proof.declared_location_name !== 'Reno Behavioral healthcare Hospital'
    || proof.declared_address !== '6940 Sierra Center Parkway, Reno, NV 89511-2209'
    || proof.declared_license_state !== 'NV' || proof.declared_date !== '2026-08-25'
    || proof.version !== '3.0.0')
  throw new Error('Reno proof or base changed; manual review required');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'first-party-contact-exact-campus-current-resources-file-complete-download-header-and-current-root-omission',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerHttpStatus: proof.pointer_http_status, pointerIssue: 'root-pointer-omits-facility',
  pointerListsFacility: false, facilityPointerToken: 'Reno',
  pointerLocationNames: proof.pointer_location_names,
  url: proof.page_mrf_url, fileSha256: proof.page_mrf_sha256,
  fileBytes: proof.page_mrf_bytes, fileTotalBytes: proof.page_mrf_total_bytes,
  http_status: proof.page_mrf_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_license_state,
  fileKind: 'csv', file_kind: 'csv',
  identityPageUrl: proof.contact_url, identityPageSha256: proof.contact_sha256,
  sourcePageUrl: proof.source_page_url, sourcePageSha256: proof.source_page_sha256,
  observedFinding: 'root-pointer-omits-facility-page-file-found', next_action: proof.next_action,
};
const entry = { ccn: '294015', base, action: 'replace-observation', evidence,
  evidence_run: 'reno-current-root-omission-page-file-2026-09-17', reviewed_at: proof.observed_at,
  note: 'The first-party contact page identifies Reno Behavioral Healthcare Hospital at the exact 6940 Sierra Center Parkway roster campus. The current root pointer is readable but lists ten other-facility entries and no Reno location or Reno CSV. The current first-party resources page links a complete 15,465-byte CSV declaring Reno Behavioral Healthcare Hospital at the same campus, NV, 2026-08-25 and v3.0.0. This is a page-linked file observation, not a pointer-linked MRF or full-schema/legal compliance determination. The earlier generic name-nonmatch remains historical.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const existing = ledger.find(row => row.ccn === entry.ccn);
if (existing && (existing.evidence_run !== entry.evidence_run || JSON.stringify(existing.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Reno resolution');
if (!existing) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !existing, ccn: entry.ccn,
  finding: evidence.observedFinding, file_sha256: proof.page_mrf_sha256 }));
