'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-whitfield-official-page-file-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '010112');
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
if (!base || base.finding !== 'no-cms-hpt-txt-published' || base.domain !== 'bwwmh.com'
    || proof.ccn !== '010112' || proof.official_domain !== 'whitfieldregionalhospital.com'
    || proof.pointer_http_status !== 404 || proof.current_mrf_http_status !== 200
    || proof.declared_state !== 'AL' || proof.declared_date !== '2026-04-01'
    || proof.version !== '3.0.0' || sample.length !== proof.retained_bytes
    || crypto.createHash('sha256').update(sample).digest('hex') !== proof.current_mrf_sha256) {
  throw new Error('Incomplete Whitfield proof or changed base');
}
const evidence = {
  identity: 'corroborated', identity_basis: 'official-pricing-page-and-file-location-exact-name-street-city-state',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  pointerHttpStatus: proof.pointer_http_status,
  url: proof.current_mrf_url, fileSha256: proof.current_mrf_sha256,
  http_status: proof.current_mrf_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.version,
  officialDomain: proof.official_domain, location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_state,
  file_kind: 'csv', sourcePageUrl: proof.official_page_url,
  sourcePageSha256: proof.official_page_sha256,
  observedFinding: 'official-page-mrf-root-pointer-unavailable',
  pointerIssue: 'root-pointer-http-error',
  next_action: proof.next_action,
};
const entry = {
  ccn: '010112', base, action: 'replace-observation', evidence,
  evidence_run: 'whitfield-current-file-root-pointer-2026-09-16', reviewed_at: proof.observed_at,
  note: 'Whitfield Regional Hospital’s current official pricing page identifies the 105 Highway 80 East Demopolis campus and links a CSV whose retained header lists the Whitfield location at the agreeing address, Alabama license state, 2026-04-01 and CMS 3.0.0. The current official root cms-hpt.txt returns HTTP 404, so this is page-linked file evidence, not pointer-linked or a compliance conclusion. The old bwwmh.com assignment is superseded.',
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) {
  if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) {
    throw new Error('Existing nonmatching Whitfield resolution');
  }
  console.log('{"applied":false}');
} else {
  ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }));
}
