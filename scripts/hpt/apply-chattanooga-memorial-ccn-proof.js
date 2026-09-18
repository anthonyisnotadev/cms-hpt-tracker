'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-chattanooga-memorial-ccn-proof.json'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === proof.ccn);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pointer = fs.readFileSync(path.join(root, proof.pointer_retained_raw));
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
const pointerText = pointer.toString('utf8');
const prefix = sample.toString('utf8', 0, 1300);
if (proof.ccn !== '440091' || !base || base.finding !== 'not-assessed-not-named-in-file'
    || base.domain !== 'memorial.org' || proof.roster_address !== '2525 DESALES AVE'
    || proof.roster_state !== 'TN' || proof.roster_zip !== '37404'
    || proof.cms_exact_ccn_name !== 'Memorial Health Care System'
    || proof.cms_exact_ccn_address !== '2525 de Sales Avenue, Chattanooga, TN 37404-1102'
    || proof.first_party_facility_name !== 'CommonSpirit - Memorial Hospital - Chattanooga'
    || proof.first_party_facility_address !== '2525 de Sales Ave, Chattanooga, TN 37404'
    || proof.first_party_price_page_links_exact_file !== true
    || proof.pointer_http_status !== 200 || pointer.length !== proof.pointer_bytes
    || sha(pointer) !== proof.pointer_sha256
    || !/location-name:\s*CHI Memorial Hospital Chattanooga\s*\r?\nsource-page-url:\s*https:\/\/www\.commonspirit\.org\/patient-resources\/memorial-price-transparency\s*\r?\nmrf-url:\s*https:\/\/www\.commonspirit\.org\/content\/dam\/commonspiritorg\/en\/chime\/sotg\/finance\/price-transparency\/620532345-1255428736_memorial-health-care-system-inc_standardcharges\.json/.test(pointerText)
    || proof.mrf_http_status !== 206 || proof.mrf_sample_bytes !== 262144
    || sample.length !== proof.mrf_sample_bytes || sha(sample) !== proof.mrf_sample_sha256
    || !prefix.startsWith('{"hospital_name":"MEMORIAL HEALTH CARE SYSTEM INC.","last_updated_on":"2026-02-28","version":"3.0.0","location_name": ["CHI Memorial Hospital - Chattanooga"],"hospital_address": ["2525 de Sales Avenue, Chattanooga, TN 37404"],"license_information":{"license_number":"71","state":"TN"}')
    || proof.declared_date !== '2026-02-28' || proof.declared_version !== '3.0.0')
  throw new Error('Chattanooga Memorial proof or base changed; manual review required');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'CMS-exact-CCN-address-first-party-hospital-page-and-price-page-exact-pointer-entry-and-retained-JSON-metadata',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  url: proof.mrf_url, fileSha256: proof.mrf_sample_sha256,
  bytesRetained: proof.mrf_sample_bytes, fileTotalBytes: proof.mrf_total_bytes,
  http_status: proof.mrf_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.declared_version,
  officialDomain: 'commonspirit.org', location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_license_state,
  file_kind: 'json', cmsExactCcnUrl: proof.cms_exact_ccn_url,
  identityPageUrl: proof.first_party_facility_url,
  sourcePageUrl: proof.first_party_price_page_url,
  observedFinding: 'compliant-observed', next_action: proof.next_action,
};
const entry = {
  ccn: proof.ccn, base, action: 'replace', evidence,
  evidence_run: 'chattanooga-memorial-exact-ccn-pointer-json-2026-09-17',
  reviewed_at: proof.observed_at,
  note: 'CMS ties 440091 Memorial Health Care System to 2525 de Sales Avenue, Chattanooga TN. The CommonSpirit Chattanooga hospital and pricing pages identify that campus and distinct JSON. The current root pointer names CHI Memorial Hospital Chattanooga and the same JSON, whose retained bounded metadata declares Memorial Health Care System Inc. at the exact campus, TN license state, 2026-02-28 and v3.0.0. The prior not-named result is historical; complete JSON charge rows and legal compliance are not established.',
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Chattanooga resolution');
if (!old) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !old, ccn: proof.ccn, finding: evidence.observedFinding }));
