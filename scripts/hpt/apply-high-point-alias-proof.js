'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-high-point-alias-proof.json'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn);
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = require(ledgerPath);
const sample = path.join(root, proof.retained_sample);
if (!base || base.finding !== 'compliant-observed' || proof.roster_name !== 'HIGH POINT REGIONAL HEALTH SYSTEM' || proof.roster_address !== '601 N ELM ST'
  || proof.declared_hospital_name !== 'High Point Regional Health' || proof.declared_license_state !== 'NC' || proof.version !== '3.0.0' || proof.file_sample_bytes < 65536
  || !fs.existsSync(sample) || crypto.createHash('sha256').update(fs.readFileSync(sample)).digest('hex') !== proof.file_sample_sha256) throw new Error('Incomplete High Point alias proof or changed base');
const evidence = { identity: 'corroborated', identity_basis: 'first-party-documented-former-name-and-exact-current-campus-with-pointer-linked-bounded-file-header', officialDomain: 'wakehealth.edu', pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256, identityPageUrl: proof.identity_page_url, identityPageSha256: proof.identity_page_sha256, url: proof.pointer_mrf_url, finalUrl: proof.mrf_final_url, fileSha256: proof.file_sample_sha256, bytesRetained: proof.file_sample_bytes, http_status: proof.file_http_status, checked_at: proof.observed_at, date: proof.declared_date, version: proof.version, location_name: proof.declared_location_name, declared_hospital_name: proof.declared_hospital_name, declared_address: proof.declared_address, declared_license_state: proof.declared_license_state, observedFinding: 'compliant-observed' };
const entry = { ccn: proof.ccn, base, action: 'replace', evidence, evidence_run: 'high-point-former-name-byte-proof-2026-09-17', reviewed_at: proof.observed_at, note: 'Wake Forest documents the High Point Regional Health to High Point Medical Center name transition. Its current contact page, exact current pointer entry, and bounded pointer-linked CSV header agree on the roster campus at 601 N Elm Street. This supersedes the generic identity-review observation while retaining the historical name and bounded-file limitation; it is not complete-file validation or a legal compliance conclusion.' };
const old = ledger.find(row => row.ccn === proof.ccn);
if (old) { if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) throw new Error('Existing nonmatching High Point resolution'); }
else { ledger.push(entry); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn)); fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`); }
console.log(JSON.stringify({ applied: old ? false : proof.ccn }));
