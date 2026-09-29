'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { records } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-ochsner-mississippi-state-proofs.json'), 'utf8'));
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .map(row => [row.ccn, row]));
const expected = new Map([
  ['250069', { finding: 'not-assessed-domain-unknown', name: 'OCHSNER RUSH HOSPITAL',
    address: '1314 19TH AVE', city: 'MERIDIAN', zip: '39301',
    location: 'Ochsner Rush Medical Center', fileAddress: '1314 19th Avenue, Meridian, MS 39301' }],
  ['250162', { finding: 'not-assessed-not-named-in-file', name: 'OCHSNER MEDICAL CENTER-HANCOCK',
    address: '149 DRINKWATER BLVD', city: 'BAY SAINT LOUIS', zip: '39520',
    location: 'Ochsner Medical Center - Hancock',
    fileAddress: '149 Drinkwater Road, Bay St. Louis, MS 39520-1658' }],
]);
const normalizeLocation = value => String(value).toLowerCase().replace(/[–—-]/g, '-').replace(/\s+/g, ' ').trim();
if (records.length !== expected.size || new Set(records.map(row => row.ccn)).size !== expected.size)
  throw new Error('Unexpected Ochsner Mississippi proof cohort');
const entries = records.map(proof => {
  const want = expected.get(proof.ccn), base = bases.get(proof.ccn);
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  if (!want || !base || base.finding !== want.finding
      || proof.roster_name !== want.name || proof.roster_address !== want.address
      || proof.roster_city !== want.city || proof.roster_state !== 'MS'
      || proof.roster_zip !== want.zip || proof.official_domain !== 'ochsner.org'
      || proof.pointer_url !== 'https://ochsner.org/cms-hpt.txt'
      || ![200, 206].includes(proof.pointer_http_status)
      || proof.pointer_location_name !== want.location
      || proof.mrf_http_status !== 206 || proof.mrf_sample_bytes !== 262144
      || sample.length !== proof.mrf_sample_bytes
      || crypto.createHash('sha256').update(sample).digest('hex') !== proof.mrf_sample_sha256
      || normalizeLocation(proof.declared_location_name) !== normalizeLocation(want.location)
      || proof.declared_address !== want.fileAddress
      || proof.declared_license_state !== 'LA' || proof.declared_date !== '2026-04-01'
      || proof.version !== '3.0.0' || !proof.identity_page_url || !proof.identity_page_sha256)
    throw new Error(`Incomplete Ochsner Mississippi proof for ${proof.ccn}`);
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'exact-first-party-facility-page-root-pointer-entry-and-retained-file-header-name-address-with-license-state-field-conflict',
    pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
    url: proof.mrf_url, fileSha256: proof.mrf_sample_sha256,
    http_status: proof.mrf_http_status, checked_at: proof.observed_at,
    date: proof.declared_date, version: proof.version, officialDomain: proof.official_domain,
    location_name: proof.declared_location_name,
    declared_hospital_name: proof.declared_hospital_name,
    declared_address: proof.declared_address, declared_license_state: proof.declared_license_state,
    facility_state: 'MS', file_kind: 'csv',
    identityPageUrl: proof.identity_page_url, identityPageSha256: proof.identity_page_sha256,
    addressCaveat: proof.hancock_address_suffix_caveat,
    observedFinding: 'mrf-license-state-field-conflicts-facility',
    next_action: proof.next_action,
  };
  return { ccn: proof.ccn, base, action: 'replace-observation', evidence,
    evidence_run: `ochsner-mississippi-state-field-2026-09-17-${proof.ccn}`,
    reviewed_at: proof.observed_at,
    note: `The current Ochsner root pointer names the ${proof.pointer_location_name} CSV, whose retained bounded header identifies ${proof.declared_location_name} at ${proof.declared_address}, dated ${proof.declared_date} on v${proof.version}. The first-party facility page corroborates the Mississippi campus, but the file's license-state field says LA. ${proof.hancock_address_suffix_caveat} Preserve this field conflict and validate the complete file separately; this is not a legal verdict.` };
});
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
for (const entry of entries) {
  const old = ledger.find(row => row.ccn === entry.ccn);
  if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
    throw new Error(`Existing nonmatching Ochsner resolution ${entry.ccn}`);
}
const additions = entries.filter(entry => !ledger.some(row => row.ccn === entry.ccn));
if (additions.length) {
  ledger.push(...additions);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: additions.map(row => row.ccn), finding: 'mrf-license-state-field-conflicts-facility' }));
