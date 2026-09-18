'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-bayonne-successor-address-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === '310025');
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
if (proof.ccn !== '310025' || !base || base.finding !== 'not-assessed-not-named-in-file'
    || base.domain !== 'carepointhealth.org'
    || base.pointer_url !== 'https://carepointhealth.org/cms-hpt.txt'
    || proof.roster_name !== 'CAREPOINT HEALTH - BAYONNE MEDICAL CENTER'
    || proof.roster_address !== '29 EAST 29TH ST' || proof.roster_city !== 'BAYONNE'
    || proof.roster_state !== 'NJ' || proof.roster_zip !== '07002'
    || proof.official_domain !== 'hudsonregionalhospital.com'
    || proof.identity_page_url !== 'https://www.hudsonregionalhospital.com/contact/'
    || !/^[a-f0-9]{64}$/.test(proof.identity_page_sha256)
    || proof.identity_page_address !== '29 E 29th Street, Bayonne, NJ 07002'
    || proof.pricing_page_url !== 'https://www.hudsonregionalhospital.com/hospital-charges/'
    || !/^[a-f0-9]{64}$/.test(proof.pricing_page_sha256)
    || proof.pricing_page_file_url !== 'https://www.hudsonregionalhospital.com/wp-content/uploads/2026/08/261442063_bayonne-university-hospital_standardcharges-2026.csv'
    || proof.pricing_page_links_file !== true
    || proof.pointer_url !== 'https://hudsonregionalhospital.com/cms-hpt.txt'
    || proof.pointer_sha256 !== 'cd2b4c6b89e158910c192bd561da0c6b2d0d21b411d8907b6cf0eb02d5d1887b'
    || proof.pointer_bytes !== 1367 || proof.legacy_pointer_sha256 !== proof.pointer_sha256
    || proof.pointer_location_name !== 'Bayonne University Hospital'
    || proof.pointer_mrf_url !== 'https://images.pricetransparency.healthcare/hudson_regional_health_bayonne/261442063_bayonne-university-hospital_standardcharges.csv'
    || proof.file_http_status !== 206 || proof.file_sample_bytes !== 262144
    || proof.file_total_bytes !== 286152286 || sample.length !== 262144
    || crypto.createHash('sha256').update(sample).digest('hex') !== proof.file_sample_sha256
    || proof.page_file_http_status !== 206 || proof.page_file_sample_bytes !== 262144
    || proof.page_file_total_bytes !== 286152286
    || proof.page_file_sample_sha256 !== proof.file_sample_sha256
    || proof.declared_hospital_name !== 'Bayonne University Hospital'
    || proof.declared_location_name !== 'Bayonne University Hospital'
    || proof.declared_address !== '29th Street & Avenue E, Bayonne, NJ 07002'
    || proof.declared_license_state !== 'NJ' || proof.declared_date !== '2026-08-17'
    || proof.version !== '3.0.0' || !Number.isFinite(Date.parse(proof.observed_at)))
  throw new Error('Bayonne proof or base changed; manual review required');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'current-successor-site-exact-campus-root-pointer-page-links-and-bounded-file-header-with-intersection-address',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  url: proof.pointer_mrf_url, fileSha256: proof.file_sample_sha256,
  bytesRetained: proof.file_sample_bytes, fileTotalBytes: proof.file_total_bytes,
  http_status: proof.file_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.pointer_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_location_name: proof.declared_location_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_license_state,
  facility_address: proof.identity_page_address, missing_address_component: '29 E 29th Street',
  file_kind: 'csv', identityPageUrl: proof.identity_page_url,
  identityPageSha256: proof.identity_page_sha256,
  sourcePageUrl: proof.pricing_page_url, sourcePageSha256: proof.pricing_page_sha256,
  pageMrfUrl: proof.pricing_page_file_url, pageMrfSha256: proof.page_file_sample_sha256,
  pageMrfHttpStatus: proof.page_file_http_status,
  observedFinding: 'mrf-address-field-incomplete', next_action: proof.next_action,
};
const entry = { ccn: '310025', base, action: 'replace-observation', evidence,
  evidence_run: 'bayonne-successor-pointer-intersection-address-2026-09-17', reviewed_at: proof.observed_at,
  note: 'The current Hudson Regional Health contact page identifies Bayonne University Hospital (formerly Bayonne Medical Center) at the roster 29 E 29th Street campus. Its root pointer and the retained CarePoint root have the same bytes and name Bayonne University Hospital, linking a readable CSV whose retained 262,144-byte header names Bayonne University Hospital, NJ, 2026-08-17 and v3.0.0. The file address is literally 29th Street & Avenue E, Bayonne, NJ 07002, whereas the first-party contact page and roster use the numbered 29 E 29th Street address. The first-party pricing page links a different on-site CSV URL whose bounded prefix and reported total bytes agree with the pointer file; complete byte equivalence is not proven. This is a source-bound identity and address-field observation, not full-file validation or a legal compliance determination. The earlier CarePoint name-nonmatch remains historical.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const existing = ledger.find(row => row.ccn === entry.ccn);
if (existing && (existing.evidence_run !== entry.evidence_run || JSON.stringify(existing.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Bayonne resolution');
if (!existing) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !existing, ccn: entry.ccn,
  finding: evidence.observedFinding, sample_sha256: proof.file_sample_sha256 }));
