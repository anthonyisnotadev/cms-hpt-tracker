'use strict';
const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..'), audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-cullman-license-state-proof.json'), 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === '010035');
const ledgerPath = path.join(audit, 'reviewed-resolutions.json'), ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (!base || base.finding !== 'compliant-observed' || proof.declared_license_state !== 'CA' || proof.facility_state !== 'AL'
    || proof.retained_bytes < 65536 || !fs.existsSync(path.join(root, proof.retained_sample))) throw new Error('Incomplete proof or changed base');
const evidence = { identity: 'corroborated', identity_basis: 'exact-pointer-file-name-street-city-and-official-page-with-conflicting-license-state-column',
  pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256, url: proof.mrf_url, finalUrl: proof.mrf_final_url,
  fileSha256: proof.mrf_sample_sha256, http_status: proof.mrf_http_status, checked_at: proof.observed_at,
  date: proof.declared_date, version: proof.version, officialDomain: 'cullmanregional.com', location_name: proof.declared_location_name,
  declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address,
  declared_license_state: proof.declared_license_state, facility_state: proof.facility_state, file_kind: 'csv',
  identityPageUrl: proof.identity_page_url, identityPageSha256: proof.identity_page_sha256,
  observedFinding: 'mrf-license-state-field-conflicts-facility' };
const entry = { ccn: '010035', base, action: 'replace-observation', evidence,
  evidence_run: 'cullman-license-state-conflict-2026-09-15', reviewed_at: proof.observed_at,
  note: 'The current root pointer and current CSV identify Cullman Regional Medical Center at 1912 Alabama Highway 157, and the current first-party site independently confirms that Alabama facility. The CSV header nevertheless labels its license-number column license_number|CA while the value is H2201. This explicit current publisher-field conflict supersedes the older generic compliant observation. The file remains identity-linked and its date/version are retained, but the tracker does not infer that CA is equivalent to AL or make a legal compliance determination.' };
const old = ledger.find(row => row.ccn === entry.ccn);
if (old) { if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) throw new Error('Existing nonmatching Cullman resolution'); console.log('{"applied":false}'); process.exit(0); }
ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn)); fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ applied: entry.ccn, finding: evidence.observedFinding }, null, 2));
