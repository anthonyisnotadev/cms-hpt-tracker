'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-uchealth-memorial-central-ccn-proof.json'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === proof.ccn);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pointer = fs.readFileSync(path.join(root, proof.pointer_retained_raw));
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
const header = sample.toString('utf8', 0, 1950);
if (proof.ccn !== '060022' || !base || base.finding !== 'not-assessed-not-named-in-file'
    || base.domain !== 'uchealth.org' || proof.roster_address !== '1400 E BOULDER ST'
    || proof.roster_state !== 'CO' || proof.roster_zip !== '80909'
    || proof.cms_exact_ccn_name !== 'Memorial Hospital'
    || proof.cms_exact_ccn_address !== '1400 East Boulder Street, Colorado Springs, CO 80909'
    || proof.first_party_facility_name !== 'UCHealth Memorial Hospital Central'
    || proof.first_party_facility_address !== '1400 E. Boulder Street, Colorado Springs, CO 80909'
    || proof.pointer_http_status !== 200 || pointer.length !== proof.pointer_bytes
    || sha(pointer) !== proof.pointer_sha256
    || !pointer.toString('utf8').includes(`location-name: ${proof.pointer_location_name}\nsource-page-url: ${proof.pointer_source_page_url}\nmrf-url: ${proof.mrf_url}`)
    || proof.mrf_http_status !== 206 || proof.mrf_sample_bytes !== 262144
    || sample.length !== proof.mrf_sample_bytes || sha(sample) !== proof.mrf_sample_sha256
    || !header.includes('hospital_name,last_updated_on,version,location_name,hospital_address,license_number|CO')
    || !header.includes('UCHMHS,2025-11-01,3.0.0,UCHealth Memorial Hospital Central,"1400 E. Boulder Street, Colorado Springs, CO 80909"')
    || proof.declared_license_state !== 'CO' || proof.declared_date !== '2025-11-01'
    || proof.declared_version !== '3.0.0')
  throw new Error('Memorial Central proof or base changed; manual review required');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'CMS-exact-CCN-and-address-first-party-facility-exact-pointer-entry-and-retained-file-header',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  url: proof.mrf_url, fileSha256: proof.mrf_sample_sha256,
  bytesRetained: proof.mrf_sample_bytes, fileTotalBytes: proof.mrf_total_bytes,
  http_status: proof.mrf_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.declared_version,
  officialDomain: 'uchealth.org', location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_license_state,
  file_kind: 'csv', cmsExactCcnUrl: proof.cms_exact_ccn_url,
  identityPageUrl: proof.first_party_facility_url,
  sourcePageUrl: proof.pointer_source_page_url,
  observedFinding: 'compliant-observed', next_action: proof.next_action,
};
const entry = {
  ccn: proof.ccn, base, action: 'replace', evidence,
  evidence_run: 'uchealth-memorial-central-exact-ccn-pointer-file-2026-09-17',
  reviewed_at: proof.observed_at,
  note: 'CMS names provider 060022 Memorial Hospital at the exact 1400 East Boulder Street Colorado Springs campus, and UCHealth identifies that campus as Memorial Hospital Central. The current UCHealth root pointer explicitly names Memorial Central and links the exact CSV; its retained bounded header declares that location/address, CO license state, 2025-11-01 and v3.0.0. The earlier not-named-in-file result remains historical. Full-file schema/rates and legal compliance are not established.',
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Memorial Central resolution');
if (!old) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !old, ccn: proof.ccn, finding: evidence.observedFinding }));
