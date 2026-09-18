'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '260110';
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-mercy-southeast-license-state-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === ccn);
const evidenceRows = csvToObjects(fs.readFileSync(
  path.join(audit, 'rechecks/2026-09-09/recovery-856/file-evidence.csv'), 'utf8'));
const rawPointer = fs.readFileSync(path.join(audit, 'pointers/mercy.net.txt'));
const pointerText = rawPointer.toString('utf8');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));

const evidenceRow = evidenceRows.find(row => row.ccn === ccn && row.url === proof.file_url);
const pointerEntry = pointerText.split(/\r?\n\s*\r?\n/).find(entry =>
  entry.includes('location-name: Mercy Hospital Southeast')
  && entry.includes(`mrf-url: ${proof.file_url}`));

if (!base || base.finding !== 'not-assessed-not-named-in-file'
    || base.pointer_url !== proof.pointer_url
    || proof.declared_license_state !== 'OK' || proof.facility_state !== 'MO'
    || !pointerEntry
    || !evidenceRow
    || evidenceRow.pointerSha256 !== proof.pointer_sha256
    || evidenceRow.member !== proof.archive_member
    || evidenceRow.header_name !== proof.declared_hospital_name
    || evidenceRow.header_address !== proof.declared_address
    || evidenceRow.header_state !== proof.declared_license_state
    || evidenceRow.date !== proof.declared_date
    || evidenceRow.version !== proof.declared_version
    || evidenceRow.fileSha256 !== proof.file_sample_sha256
    || evidenceRow.http_status !== String(proof.file_http_status)) {
  throw new Error('Mercy Hospital Southeast base, pointer, or bounded-header proof changed');
}

const evidence = {
  identity: 'corroborated',
  identity_basis: 'current-mercy-root-pointer-exact-facility-entry-and-bounded-zip-csv-header-match-roster-address-with-conflicting-license-state-field',
  officialDomain: 'mercy.net',
  sourcePageUrl: proof.source_page_url,
  pointerUrl: proof.pointer_url,
  pointerSha256: proof.pointer_sha256,
  url: proof.file_url,
  fileSha256: proof.file_sample_sha256,
  http_status: proof.file_http_status,
  checked_at: proof.observed_at,
  date: proof.declared_date,
  version: proof.declared_version,
  location_name: 'Mercy Hospital Southeast',
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_license_state,
  facility_state: proof.facility_state,
  file_kind: 'zip',
  observedFinding: 'mrf-license-state-field-conflicts-facility',
  next_action: 'Obtain publisher clarification/correction of the OK license-state field for this Missouri facility and complete ZIP/member validation before any clean-file or legal-compliance conclusion.'
};
const entry = {
  ccn,
  base,
  action: 'replace-observation',
  evidence,
  evidence_run: 'mercy-southeast-license-state-conflict-2026-09-17',
  reviewed_at: proof.observed_at,
  note: 'The prior reviewed file was Mercy Pediatrics at a different Cape Girardeau address. A separate exact current Mercy root-pointer entry names Mercy Hospital Southeast and its ZIP. The bounded CSV member header identifies Southeast Hospital dba Mercy Hospital Southeast at 1701 Lacey St, Cape Girardeau MO 63701, dated 2026-06-11 on CMS 3.0.0, but labels its license-state field OK rather than MO. This replaces the generic nonmatch with a specific publisher metadata conflict; it is not a clean verification or legal compliance conclusion.'
};
const old = ledger.find(row => row.ccn === ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) {
    throw new Error('Existing nonmatching Mercy Hospital Southeast resolution');
  }
  console.log(JSON.stringify({ applied: false }));
} else {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(JSON.stringify({ applied: ccn, finding: evidence.observedFinding }));
}
