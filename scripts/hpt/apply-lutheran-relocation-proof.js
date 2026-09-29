'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..'), audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-lutheran-relocation-proof.json'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
const ledgerPath = path.join(audit, 'reviewed-resolutions.json'), ledger = require(ledgerPath);
const sample = path.join(root, proof.retained_sample);
if (!base || base.finding !== 'compliant-observed' || proof.former_roster_address !== '8300 W 38TH AVE'
    || proof.declared_license_state !== 'CO' || proof.version !== '3.0.0'
    || proof.retained_bytes < 65536 || !fs.existsSync(sample)
    || crypto.createHash('sha256').update(fs.readFileSync(sample)).digest('hex') !== proof.mrf_sample_sha256)
  throw new Error('Incomplete Lutheran relocation proof or changed base');
const evidence = { identity: 'corroborated',
  identity_basis: 'first-party-documented-lutheran-hospital-relocation-from-roster-campus-to-exact-pointer-linked-current-file-campus',
  officialDomain: 'intermountainhealthcare.org', pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
  sourcePageUrl: proof.source_page_url, identityPageUrl: proof.identity_page_url, identityPageSha256: proof.identity_page_sha256,
  url: proof.mrf_url, finalUrl: proof.mrf_final_url, fileSha256: proof.mrf_sample_sha256, bytesRetained: proof.retained_bytes,
  http_status: proof.mrf_http_status, checked_at: proof.observed_at, date: proof.declared_date, version: proof.version,
  location_name: proof.declared_location_name, declared_hospital_name: proof.declared_hospital_name,
  declared_address: proof.declared_address, declared_license_state: proof.declared_license_state,
  observedFinding: 'compliant-observed' };
const entry = { ccn: proof.ccn, base, action: 'replace', evidence, evidence_run: 'lutheran-relocation-byte-proof-2026-09-17',
  reviewed_at: proof.observed_at,
  note: 'Intermountain documents that Lutheran Hospital moved from the roster\'s former 8300 W 38th Avenue campus to 12911 W 40th Avenue in 2024. The current first-party facility page, exact pointer entry, and bounded CMS 3.0.0 file header independently identify the new Wheat Ridge campus. This supersedes the newer generic address mismatch while retaining the former roster address and the bounded-file limitation in history; it is not complete-file validation or a legal compliance conclusion.' };
const old = ledger.find(row => row.ccn === proof.ccn);
if (old) { if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) throw new Error('Existing nonmatching Lutheran resolution'); }
else { ledger.push(entry); ledger.sort((a,b) => a.ccn.localeCompare(b.ccn)); fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger,null,2)}\n`); }
console.log(JSON.stringify({ applied: old ? false : proof.ccn }));
