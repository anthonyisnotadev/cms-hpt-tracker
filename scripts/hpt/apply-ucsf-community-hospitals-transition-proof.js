'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { parsePointer } = require('./lib/parse');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = require(path.join(audit, 'reconciliation-ucsf-community-hospitals-transition-proof.json'));
const baseRows = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
const entries = parsePointer(fs.readFileSync(path.join(root, proof.sanitized_pointer_entries), 'utf8')).entries;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
if (proof.records.length !== 2 || entries.length !== 2
    || proof.pointer_http_status !== 200 || proof.pointer_bytes !== 826
    || proof.pointer_sha256 !== '1f37f2848960c07e74cad2d4efb11c6871f5e7205d5323ad63bc03ea0a94d0d9'
    || proof.publisher_domain !== 'sfcommunityhospitals.ucsfhealth.org'
    || proof.records[0].ccn !== '050152' || proof.records[1].ccn !== '050457'
    || proof.records[0].mrf_url === proof.records[1].mrf_url)
  throw new Error('UCSF community-hospitals cohort proof changed; manual review required');

const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
let applied = 0;
for (const [i, row] of proof.records.entries()) {
  const base = baseRows.find(item => item.ccn === row.ccn);
  const pointer = entries[i];
  const sample = fs.readFileSync(path.join(root, row.retained_sample));
  const prefix = sample.toString('utf8', 0, 800);
  if (!base || base.finding !== 'not-assessed-not-named-in-file'
      || base.domain !== 'dignityhealth.org' || base.pointer_url !== 'https://commonspirit.org/cms-hpt.txt'
      || row.roster_state !== 'CA' || row.roster_zip !== row.first_party_address.slice(-5)
      || !row.first_party_address.toUpperCase().startsWith(row.roster_address)
      || pointer.locationName !== row.pointer_location_name
      || pointer.sourcePageUrl !== row.source_page_url || pointer.mrfUrl !== row.mrf_url
      || row.mrf_http_status !== 206 || row.mrf_sample_bytes !== 262144
      || sample.length !== row.mrf_sample_bytes || sha(sample) !== row.mrf_sample_sha256
      || !prefix.startsWith(`{"hospital_name":"${row.declared_hospital_name}","last_updated_on":"${row.declared_date}","version":"${row.declared_version}","location_name": ["${row.declared_location_name}"],"hospital_address": ["${row.declared_address}"],"license_information":`)
      || !prefix.includes(`"state":"${row.declared_license_state}"`)
      || row.declared_license_state !== row.roster_state)
    throw new Error(`UCSF ${row.ccn} source or base changed; manual review required`);
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'first-party-UCSF-rename-and-exact-campus-pointer-page-and-distinct-Box-JSON-metadata',
    pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
    pointerLocationName: row.pointer_location_name,
    sourcePageUrl: row.source_page_url,
    transitionPageUrl: proof.first_party_transition_url,
    identityPageUrl: proof.first_party_hospitals_url,
    url: row.mrf_url, fileSha256: row.mrf_sample_sha256,
    bytesRetained: row.mrf_sample_bytes, fileTotalBytes: row.mrf_total_bytes,
    http_status: row.mrf_http_status, checked_at: proof.observed_at,
    date: row.declared_date, version: row.declared_version,
    officialDomain: proof.publisher_domain, file_kind: 'json',
    location_name: row.declared_location_name,
    declared_hospital_name: row.declared_hospital_name,
    declared_address: row.declared_address,
    declared_license_state: row.declared_license_state,
    observedFinding: 'compliant-observed', next_action: proof.next_action,
  };
  const entry = {
    ccn: row.ccn, base, action: 'replace', evidence,
    evidence_run: 'ucsf-community-hospitals-transition-pointer-json-2026-09-17',
    reviewed_at: proof.observed_at,
    note: `${row.current_name} is the first-party successor name for ${row.pointer_location_name} at ${row.first_party_address}. The current community-hospitals root pointer and hospital price page link this CCN's distinct Box JSON; fresh bounded bytes declare ${row.declared_hospital_name} at the same campus, CA license state, 2026-02-28 and v3.0.0. The earlier Dignity/CommonSpirit no-entry result is historical; complete JSON charge rows and legal compliance are not established.`,
  };
  const old = ledger.find(item => item.ccn === row.ccn);
  if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence)))
    throw new Error(`Existing nonmatching UCSF ${row.ccn} resolution`);
  if (!old) { ledger.push(entry); applied++; }
}
if (applied) {
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}
console.log(JSON.stringify({ applied, ccns: proof.records.map(row => row.ccn) }));
