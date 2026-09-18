'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { records } = JSON.parse(fs.readFileSync(path.join(audit,
  'reconciliation-hpi-pointer-page-proofs.json'), 'utf8'));
const baseBy = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .map(row => [row.ccn, row]));
const rosterBy = new Map(JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
  .map(row => [row.ccn, row]));
const expected = new Map([
  ['241320', { domain: 'riverviewhealth.org', hospital: 'RiverView Health Association',
    location: 'RiverView Health', street: '323 S Minnesota St', rosterStreet: '323 SOUTH MINNESOTA',
    city: 'CROOKSTON', state: 'MN', zip: '56716', date: '2026-05-15' }],
  ['260025', { domain: 'hannibalregional.org', hospital: 'Hannibal Regional Hospital',
    location: 'Hannibal Regional Hospital', street: '6000 Hospital Drive', rosterStreet: '6000 HOSPITAL DR',
    city: 'HANNIBAL', state: 'MO', zip: '63401', date: '2026-08-14' }],
  ['281357', { domain: 'sidneyrmc.com', hospital: 'Cheyenne County Hospital Association Inc',
    location: 'Sidney Regional Medical Center', street: '1000 Pole Creek Crossing', rosterStreet: '1000 POLE CREEK CROSSING',
    city: 'SIDNEY', state: 'NE', zip: '69162', date: '2026-01-09' }],
]);
if (records.length !== expected.size || new Set(records.map(row => row.ccn)).size !== expected.size)
  throw new Error('Unexpected HPI proof cohort');

const entries = records.map(proof => {
  const want = expected.get(proof.ccn), base = baseBy.get(proof.ccn), facility = rosterBy.get(proof.ccn);
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  if (!want || !base || base.finding !== 'mrf-url-unreachable' || base.domain !== want.domain
      || base.mrf_url !== proof.pointer_mrf_url || proof.official_domain !== want.domain
      || proof.pointer_mrf_http_status !== 404 || proof.current_mrf_http_status !== 206
      || proof.pointer_mrf_url === proof.current_mrf_url
      || proof.rendered_source_download_url !== proof.current_mrf_url
      || proof.rendered_source_update !== want.date || !proof.rendered_source_observed_at
      || !proof.source_page_url.startsWith('https://search.hospitalpriceindex.com/hpi2/machineReadable/')
      || !/^[a-f0-9]{64}$/.test(proof.source_page_shell_sha256)
      || proof.retained_bytes !== 262144 || sample.length !== proof.retained_bytes
      || crypto.createHash('sha256').update(sample).digest('hex') !== proof.current_mrf_sha256
      || proof.declared_hospital_name !== want.hospital
      || !proof.declared_location_name.includes(want.location)
      || !proof.declared_address.includes(want.street) || !proof.declared_address.includes(want.zip)
      || proof.declared_state !== want.state || proof.declared_date !== want.date
      || proof.version !== '3.0.0' || facility?.address !== want.rosterStreet
      || facility.city !== want.city || facility.state !== want.state || facility.zip !== want.zip)
    throw new Error(`Incomplete HPI proof or changed base for ${proof.ccn}`);
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'first-party-hospital-location-page-plus-pointer-source-route-rendered-link-and-retained-file-header-name-address-state',
    pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
    pointerHttpStatus: proof.pointer_http_status, pointerMrfUrl: proof.pointer_mrf_url,
    pointerMrfHttpStatus: proof.pointer_mrf_http_status,
    url: proof.current_mrf_url, fileSha256: proof.current_mrf_sha256,
    http_status: proof.current_mrf_http_status, checked_at: proof.observed_at,
    date: proof.declared_date, version: proof.version, officialDomain: proof.official_domain,
    location_name: proof.declared_location_name, declared_hospital_name: proof.declared_hospital_name,
    declared_address: proof.declared_address, declared_license_state: proof.declared_state,
    file_kind: 'csv', sourcePageUrl: proof.source_page_url,
    sourcePageShellSha256: proof.source_page_shell_sha256,
    browserSourceHeading: proof.rendered_source_heading,
    browserSourceObservedAt: proof.rendered_source_observed_at,
    observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
    pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: proof.next_action,
  };
  return { ccn: proof.ccn, base, action: 'replace-observation', evidence,
    evidence_run: `hpi-pointer-page-mismatch-2026-09-16-${proof.ccn}`,
    reviewed_at: proof.observed_at,
    note: `The ${facility.name} first-party root pointer names a CSV returning HTTP 404. Its pointer-declared Hospital Price Index source route rendered a different Download File URL, whose retained 262,144-byte header identifies ${want.location} at ${want.street}, ${want.city} ${want.state} ${want.zip}, ${want.state} license state, ${want.date} and CMS v3.0.0. The first-party hospital location page independently confirms the address. The source-page CSV is not the working pointer target and its complete structure is not validated.` };
});
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
for (const entry of entries) {
  const old = ledger.find(row => row.ccn === entry.ccn);
  if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
    throw new Error(`Existing nonmatching HPI resolution ${entry.ccn}`);
}
const additions = entries.filter(entry => !ledger.some(row => row.ccn === entry.ccn));
if (additions.length) {
  ledger.push(...additions);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: additions.map(row => row.ccn), already_present: entries.length - additions.length }));
