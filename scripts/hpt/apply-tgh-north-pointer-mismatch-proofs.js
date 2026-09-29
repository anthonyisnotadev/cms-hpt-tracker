'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const { records } = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-tgh-north-pointer-mismatch-proofs.json'), 'utf8'));
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .map(row => [row.ccn, row]));
const roster = new Map(JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
  .map(row => [row.ccn, row]));
const expected = new Map([
  ['100071', { name: 'Tampa General Hospital Brooksville', street: '17240 Cortez Blvd', zip: '34601', rosterAddress: '17240 CORTEZ BLVD' }],
  ['100249', { name: 'Tampa General Hospital Crystal River', street: '6201 N Suncoast Blvd', zip: '34428', rosterAddress: '6201 N SUNCOAST BLVD' }],
]);
if (records.length !== expected.size || new Set(records.map(row => row.ccn)).size !== expected.size)
  throw new Error('Unexpected TGH North proof cohort');

const entries = records.map(proof => {
  const want = expected.get(proof.ccn), base = bases.get(proof.ccn), facility = roster.get(proof.ccn);
  const sample = fs.readFileSync(path.join(root, proof.retained_sample));
  if (!want || !base || base.finding !== 'mrf-url-unreachable' || base.domain !== 'tgh.org'
      || base.mrf_url !== proof.pointer_mrf_url || proof.pointer_mrf_http_status !== 404
      || proof.current_mrf_http_status !== 206 || proof.pointer_mrf_url === proof.current_mrf_url
      || proof.retained_bytes !== 262144 || sample.length !== proof.retained_bytes
      || crypto.createHash('sha256').update(sample).digest('hex') !== proof.current_mrf_sha256
      || proof.declared_hospital_name !== want.name || !proof.declared_address.includes(want.street)
      || !proof.declared_address.includes(want.zip) || proof.declared_state !== 'FL'
      || proof.declared_date !== '2026-04-01' || proof.version !== '3.0.0'
      || facility?.address !== want.rosterAddress || facility.zip !== want.zip)
    throw new Error(`Incomplete TGH North proof or changed base for ${proof.ccn}`);
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'current-first-party-pricing-and-location-pages-plus-retained-file-header-name-address-state',
    pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
    pointerHttpStatus: proof.pointer_http_status, pointerMrfUrl: proof.pointer_mrf_url,
    pointerMrfHttpStatus: proof.pointer_mrf_http_status,
    url: proof.current_mrf_url, fileSha256: proof.current_mrf_sha256,
    http_status: proof.current_mrf_http_status, checked_at: proof.observed_at,
    date: proof.declared_date, version: proof.version, officialDomain: proof.official_domain,
    location_name: proof.declared_location_name, declared_hospital_name: proof.declared_hospital_name,
    declared_address: proof.declared_address, declared_license_state: proof.declared_state,
    file_kind: 'csv', sourcePageUrl: proof.source_page_url, sourcePageSha256: proof.source_page_sha256,
    observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
    pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: proof.next_action,
  };
  return { ccn: proof.ccn, base, action: 'replace-observation', evidence,
    evidence_run: `tgh-north-pointer-page-mismatch-2026-09-16-${proof.ccn}`, reviewed_at: proof.observed_at,
    note: `The current TGH root pointer names an ${want.name} file URL returning HTTP 404. The first-party TGH North pricing page instead links a different CSV; its retained 262,144-byte header identifies ${want.name} at ${want.street}, ${facility.city} FL ${want.zip}, Florida license state, 2026-04-01 and CMS v3.0.0. The official location page independently confirms the address. The page-linked file is not a working pointer target or a full-file validation.` };
});
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
for (const entry of entries) {
  const old = ledger.find(row => row.ccn === entry.ccn);
  if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
    throw new Error(`Existing nonmatching TGH North resolution ${entry.ccn}`);
}
const additions = entries.filter(entry => !ledger.some(row => row.ccn === entry.ccn));
if (additions.length) {
  ledger.push(...additions);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: additions.map(row => row.ccn), already_present: entries.length - additions.length }));
