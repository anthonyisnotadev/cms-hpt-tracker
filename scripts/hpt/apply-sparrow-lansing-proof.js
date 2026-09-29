'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-sparrow-lansing-proof.json')));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/uofmhealthsparrow.org-2e87ccdc4596.txt'));
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (proof.ccn !== '230230' || base?.finding !== 'not-assessed-not-named-in-file'
    || base.state !== 'MI' || sha(pointer) !== proof.pointer_sha256
    || sha(sample) !== proof.retained_sha256 || sample.length !== 262144
    || !pointer.toString('utf8').includes(`mrf-url: ${proof.mrf_url}`)
    || !pointer.toString('utf8').includes(`mrf-url: ${proof.separate_st_lawrence_pointer_mrf_url}`)
    || proof.declared_hospital_name !== 'University of Michigan Health-Sparrow Lansing'
    || !proof.declared_address.startsWith('1215 E Michigan Ave, Lansing, MI 48912|')
    || proof.declared_license_state !== 'CA' || proof.facility_state !== 'MI'
    || proof.declared_date !== '2026-04-01' || proof.declared_version !== '4.2')
  throw new Error('Lansing source or base proof changed');
const evidence = { identity: 'corroborated',
  identity_basis: 'first-party-explicit-sparrow-lansing-rename-exact-campus-root-pointer-page-link-and-shared-location-csv-header-with-license-state-conflict',
  officialDomain: 'uofmhealthsparrow.org', identityPageUrl: proof.facility_page_url,
  identityPageSha256: proof.facility_page_sha256, renamePageUrl: proof.rename_page_url,
  renamePageSha256: proof.rename_page_sha256, sourcePageUrl: proof.source_page_url,
  sourcePageSha256: proof.source_page_sha256, pointerUrl: proof.pointer_url,
  pointerSha256: proof.pointer_sha256, url: proof.mrf_url, fileSha256: proof.retained_sha256,
  http_status: proof.mrf_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.declared_version,
  location_name: 'University of Michigan Health-Sparrow Lansing',
  declared_hospital_name: proof.declared_hospital_name,
  declared_location_name: proof.declared_location_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_license_state,
  facility_state: proof.facility_state, file_kind: 'csv',
  observedFinding: 'mrf-license-state-field-conflicts-facility',
  next_action: 'Ask the publisher to confirm or correct the CA license-number field for the Michigan Lansing campus, and review literal version 4.2. Verify complete CSV content and the scope of its second St. Lawrence location separately; do not assign the separate St. Lawrence pointer file to CCN 230230 or infer a legal verdict.' };
const resolution = { ccn: proof.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'sparrow-lansing-shared-header-state-conflict-2026-09-17', reviewed_at: proof.observed_at,
  note: 'The publisher says Sparrow Hospital in Lansing became UM Health-Sparrow Lansing, whose current page matches the roster at 1215 E Michigan Ave. The current root and price page link its Lansing CSV, whose bounded header lists both Lansing and St. Lawrence but assigns the primary Lansing address exactly. The license-number field declares CA against this Michigan campus and the version is literal 4.2. A separate St. Lawrence pointer entry/file remains separate. This is a specific metadata conflict, not complete-file validation or a legal verdict.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old) {
  if (old.evidence_run !== resolution.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))
    throw new Error('Existing nonmatching Lansing resolution');
} else {
  ledger.push(resolution);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ ccn: proof.ccn, applied: !old }));
