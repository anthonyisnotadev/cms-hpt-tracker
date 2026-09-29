'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-lake-huron-current-proof.json')));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/mylakehuron.com-351626c25224.txt'));
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (proof.ccn !== '230031' || base?.finding !== 'compliant-observed'
    || base.mrf_url !== proof.prior_standing_mrf_url || base.mrf_url === proof.mrf_url
    || sha(pointer) !== proof.pointer_sha256 || sha(sample) !== proof.retained_sha256
    || !proof.pointer_matches_retained_raw || !proof.file_matches_retained_sample
    || !pointer.toString('utf8').includes(`mrf-url: ${proof.mrf_url}`)
    || proof.declared_address !== '2601 Electric Avenue Port Huron, MI  48060'
    || proof.declared_license_state !== 'MI' || proof.declared_date !== '2026-09-01'
    || proof.declared_version !== '3.0' || proof.retained_bytes !== 262144)
  throw new Error('Lake Huron baseline or current source proof changed');
const evidence = { identity: 'corroborated',
  identity_basis: 'first-party-browser-campus-address-current-exact-root-pointer-and-rechecked-selected-file-header',
  officialDomain: 'mylakehuron.com', identityPageUrl: 'https://mylakehuron.com/',
  browserIdentityObservation: proof.browser_identity_observation,
  browserIdentityObservedAt: proof.browser_site_observed_at,
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerHttpStatus: proof.pointer_http_status, url: proof.mrf_url,
  fileSha256: proof.retained_sha256, http_status: proof.mrf_http_status,
  checked_at: proof.file_observed_at, date: proof.declared_date, version: proof.declared_version,
  expected_version: '3.0.0', location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_license_state,
  facility_state: 'MI', file_kind: 'json', observedFinding: 'mrf-template-version-noncanonical',
  next_action: 'Review the literal 3.0 template identifier with the publisher, then validate the complete September JSON. The earlier browser/client challenge is a transport observation and does not negate the now rechecked exact pointer and file bytes.' };
const resolution = { ccn: proof.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'lake-huron-current-pointer-file-recheck-2026-09-17', reviewed_at: proof.file_observed_at,
  note: 'The later root pointer and selected September JSON match newly rechecked exact bytes. Its bounded header names Lake Huron Medical Center at the roster Port Huron campus, MI, dated 2026-09-01; it declares literal version 3.0, not canonical 3.0.0. The earlier April file and the intervening browser/client challenge remain historical. This is a template-identifier review, not complete-file validation or a legal verdict.' };
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old) {
  if (old.evidence_run !== resolution.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence))
    throw new Error('Existing nonmatching Lake Huron resolution');
} else {
  ledger.push(resolution);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ ccn: proof.ccn, applied: !old }));
