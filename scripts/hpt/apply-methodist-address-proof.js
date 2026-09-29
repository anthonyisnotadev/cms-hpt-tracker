'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-methodist-address-proof.json')));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/healthpartners.com-02cef7388d09.txt'));
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (proof.ccn !== '240053' || base?.finding !== 'not-assessed-not-named-in-file'
    || base.hospital_name !== 'PARK NICOLLET METHODIST HOSPITAL' || base.state !== 'MN'
    || sha(pointer) !== proof.pointer_sha256 || sha(sample) !== proof.retained_sha256
    || sample.length !== 262144 || !pointer.toString('utf8').includes(`mrf-url: ${proof.mrf_url}`)
    || proof.declared_hospital_name !== 'Methodist Hospital'
    || proof.declared_address !== '6500 Exclesior Blvd, St. Louis Park, MN 55426-4702'
    || proof.declared_license_state !== 'MN' || proof.declared_date !== '2026-03-31'
    || proof.declared_version !== '3.0.0')
  throw new Error('Methodist source/base proof changed');
const evidence = { identity: 'corroborated',
  identity_basis: 'first-party-methodist-exact-campus-pricing-page-root-pointer-csv-header-with-street-spelling-conflict',
  officialDomain: 'healthpartners.com', identityPageUrl: proof.facility_page_url,
  identityPageSha256: proof.facility_page_sha256, formerNameSourceUrl: proof.former_name_source_url,
  sourcePageUrl: proof.source_page_url, sourcePageSha256: proof.source_page_sha256,
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  url: proof.mrf_url, fileSha256: proof.retained_sha256,
  http_status: proof.mrf_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.declared_version,
  location_name: proof.declared_location_name, declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address, facility_address: '6500 Excelsior Blvd., St. Louis Park, MN 55426',
  declared_license_state: proof.declared_license_state, facility_state: 'MN', file_kind: 'csv',
  observedFinding: 'mrf-address-field-conflicts-facility',
  next_action: 'Ask the publisher to confirm or correct the CSV street spelling Exclesior versus its own Excelsior campus page; validate the complete CSV separately. Do not infer a different hospital or a legal compliance verdict from the typo.' };
const resolution = { ccn: proof.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'methodist-park-nicollet-address-spelling-2026-09-17', reviewed_at: proof.observed_at,
  note: 'The former Park Nicollet Methodist name and current Methodist Hospital identify the same 6500 Excelsior Boulevard campus. The current first-party price page and root pointer link an identity-matched CSV, dated 2026-03-31 with MN license state and version 3.0.0. The CSV address spells the street Exclesior rather than Excelsior. Preserve that literal discrepancy as a bounded publisher-field observation, not a clean-file or legal verdict.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old) {
  if (old.evidence_run !== resolution.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))
    throw new Error('Existing nonmatching Methodist resolution');
} else {
  ledger.push(resolution);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ ccn: proof.ccn, applied: !old }));
