'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-ochsner-choctaw-field-proof.json'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
  .find(row => row.ccn === '011304');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pointer = fs.readFileSync(path.join(root, proof.pointer_retained_raw));
const sample = fs.readFileSync(path.join(root, proof.retained_sample));
const prefix = sample.toString('utf8', 0, 2200);
if (!base || base.finding !== 'not-assessed-not-named-in-file'
    || base.domain !== 'ochsnerrush.org' || proof.roster_state !== 'AL'
    || proof.pointer_http_status !== 200 || pointer.length !== proof.pointer_bytes
    || sha(pointer) !== proof.pointer_sha256
    || !pointer.toString('utf8').includes(`location-name: ${proof.pointer_location_name}\nsource-page-url: ${proof.price_page.replace(/\/$/, '')}\nmrf-url:${proof.mrf_url}`)
    || proof.mrf_http_status !== 206 || sample.length !== proof.mrf_sample_bytes
    || sha(sample) !== proof.mrf_sample_sha256
    || !prefix.includes('hospital_name,last_updated_on,version,location_name,hospital_address,license_number|LA')
    || !prefix.includes('"Rush Hospital/Butler, Inc.",4/1/2026,3.0.0,Ochsner Choctaw General Hospital,"401 Vanity Fair Lane , Butler, AL 36904",H1201|AL')
    || proof.declared_license_state_column !== 'LA'
    || proof.declared_last_updated_on !== '2026-04-01' || proof.declared_version !== '3.0.0')
  throw new Error('Ochsner Choctaw proof or base changed; manual review required');

const evidence = {
  identity: 'corroborated',
  identity_basis: 'exact-first-party-Choctaw-page-root-pointer-entry-and-retained-file-header-with-license-state-column-conflict',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  url: proof.mrf_url, fileSha256: proof.mrf_sample_sha256,
  bytesRetained: proof.mrf_sample_bytes, http_status: proof.mrf_http_status,
  checked_at: proof.observed_at, date: proof.declared_last_updated_on,
  version: proof.declared_version, officialDomain: 'ochsner.org',
  location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address,
  declared_license_state: proof.declared_license_state_column,
  declared_license_value: proof.declared_license_value,
  facility_state: 'AL', file_kind: 'csv', identityPageUrl: proof.first_party_page,
  sourcePageUrl: proof.price_page,
  addressCaveat: 'The first-party facility page says Vanity Fair Ave.; the roster and CSV say Vanity Fair Lane at the same number/city/ZIP. Equivalence is not established.',
  observedFinding: 'mrf-license-state-field-conflicts-facility',
  next_action: proof.next_action,
};
const entry = {
  ccn: proof.ccn, base, action: 'replace-observation', evidence,
  evidence_run: 'ochsner-choctaw-field-review-2026-09-17', reviewed_at: proof.observed_at,
  note: 'The current Ochsner root pointer and first-party price page link the distinct Choctaw CSV. A fresh retained bounded header names the Butler Alabama hospital and 401 Vanity Fair Lane, dated 2026-04-01 on v3.0.0, but labels its license-number column LA even though its value ends AL. The first-party facility page says Vanity Fair Ave.; neither the address difference nor full file/rate validity is resolved. No legal-compliance verdict is made.',
};
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const old = ledger.find(row => row.ccn === proof.ccn);
if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
  throw new Error('Existing nonmatching Choctaw resolution');
if (!old) {
  ledger.push(entry);
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied: !old, ccn: proof.ccn, finding: evidence.observedFinding }));
