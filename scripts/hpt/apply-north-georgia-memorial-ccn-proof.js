'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-north-georgia-memorial-ccn-proof.json'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === proof.ccn);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pointer = fs.readFileSync(path.join(root, proof.pointer_retained_raw));
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
const pointerText = pointer.toString('utf8');
const prefix = sample.toString('utf8', 0, 1300);
if (proof.ccn !== '110236' || !base || base.finding !== 'not-assessed-not-named-in-file'
    || base.domain !== 'memorial.org' || proof.roster_address !== '4710 BATTLEFIELD PARKWAY'
    || proof.roster_state !== 'GA' || proof.roster_zip !== '30736'
    || proof.cms_exact_ccn_name !== 'CHI MEMORIAL HOSPITAL - GEORGIA'
    || proof.first_party_facility_name !== 'CommonSpirit - Memorial Hospital - North Georgia'
    || proof.first_party_facility_address !== '4710 Battlefield Pkwy, Ringgold, GA 30736'
    || proof.first_party_price_page_links_exact_file !== true
    || proof.pointer_http_status !== 200 || pointer.length !== proof.pointer_bytes
    || sha(pointer) !== proof.pointer_sha256
    || !/location-name:\s*CHI Memorial Hospital - Georgia\s*\r?\nsource-page-url:\s*https:\/\/www\.commonspirit\.org\/patient-resources\/memorial-price-transparency\s*\r?\nmrf-url:\s*https:\/\/www\.commonspirit\.org\/content\/dam\/commonspiritorg\/en\/chime\/sotg\/finance\/price-transparency\/822748395-1356860621_chi-memorial-hospital-georgia_standardcharges\.json/.test(pointerText)
    || proof.mrf_http_status !== 206 || proof.mrf_sample_bytes !== 262144
    || sample.length !== proof.mrf_sample_bytes || sha(sample) !== proof.mrf_sample_sha256
    || !prefix.startsWith('{"hospital_name":"CHI MEMORIAL HOSPITAL - GEORGIA","last_updated_on":"2026-02-28","version":"3.0.0","location_name": ["CHI Memorial Hospital - Georgia"],"hospital_address": ["4710 Battlefield Pkwy, Ringgold, GA 30736"],"license_information":{"license_number":"033-1000","state":"GA"},"type_2_npi": ["1356860621"]')
    || proof.declared_date !== '2026-02-28' || proof.declared_version !== '3.0.0')
  throw new Error('North Georgia Memorial proof or base changed; manual review required');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'CMS-exact-CCN-legacy-name-first-party-campus-transition-and-price-page-exact-pointer-entry-and-retained-JSON-metadata',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  url: proof.mrf_url, fileSha256: proof.mrf_sample_sha256,
  bytesRetained: proof.mrf_sample_bytes, fileTotalBytes: proof.mrf_total_bytes,
  http_status: proof.mrf_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.declared_version,
  officialDomain: 'commonspirit.org', location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_license_state,
  declared_type_2_npi: proof.declared_type_2_npi, file_kind: 'json',
  cmsExactCcnUrl: proof.cms_exact_ccn_url,
  identityPageUrl: proof.first_party_facility_url,
  transitionPageUrl: proof.first_party_transition_url,
  sourcePageUrl: proof.first_party_price_page_url,
  observedFinding: 'compliant-observed', next_action: proof.next_action,
};
const entry = {
  ccn: proof.ccn, base, action: 'replace', evidence,
  evidence_run: 'north-georgia-memorial-exact-ccn-pointer-json-2026-09-17',
  reviewed_at: proof.observed_at,
  note: 'CMS ties 110236 to the CHI Memorial Georgia name. CommonSpirit identifies the new North Georgia campus at 4710 Battlefield Parkway and says patients transferred from the former CHI Memorial Georgia campus. The publisher price page and root pointer link a distinct Georgia JSON whose fresh bounded metadata declares that exact new campus, GA license state, 2026-02-28 and v3.0.0. Complete charge rows and legal compliance are not established; Chattanooga and Hixson remain separate.',
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching North Georgia resolution');
if (!old) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !old, ccn: proof.ccn, finding: evidence.observedFinding }));
