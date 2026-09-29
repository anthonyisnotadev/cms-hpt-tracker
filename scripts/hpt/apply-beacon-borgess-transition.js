'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-beacon-borgess-transition-proof.json')));
const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/beaconhealthsystem.org-9d5361253689.txt'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
if (sha(pointer) !== proof.pointer_sha256 || proof.records.length !== 2
    || proof.records.map(row => row.ccn).join(',') !== '230117,231315')
  throw new Error('Beacon root or two-campus proof changed');
const applied = [];
for (const record of proof.records) {
  const base = bases.get(record.ccn);
  const sample = fs.readFileSync(path.join(root, record.retained_sample));
  if (!base || base.finding !== 'not-assessed-not-named-in-file' || base.state !== 'MI'
      || base.hospital_name !== record.roster_name || base.mrf_url
      || sha(sample) !== record.retained_sha256 || sample.length !== 262144
      || !pointer.toString('utf8').includes(`mrf-url: ${record.mrf_url}`)
      || !record.mrf_url.endsWith('?v=2') || record.pricing_page_mrf_url !== record.mrf_url.replace('v=2', 'v=3')
      || !record.pricing_page_pointer_prefixes_match
      || record.pricing_page_mrf_prefix_sha256 !== record.retained_sha256
      || record.declared_license_state !== 'MI' || record.declared_date !== '2026-01-01'
      || record.declared_version !== '3.0.0')
    throw new Error(`Beacon ${record.ccn} source/base conflict`);
  const evidence = { identity: 'corroborated',
    identity_basis: 'first-party-beacon-former-borgess-exact-campus-current-root-pointer-and-distinct-csv-header',
    officialDomain: 'beaconhealthsystem.org', identityPageUrl: record.facility_page_url,
    identityPageSha256: record.facility_page_sha256, transitionPageUrl: proof.transition_page_url,
    transitionPageSha256: proof.transition_page_sha256, sourcePageUrl: proof.source_page_url,
    sourcePageSha256: proof.source_page_sha256, pageMrfUrl: record.pricing_page_mrf_url,
    pageMrfPrefixSha256: record.pricing_page_mrf_prefix_sha256,
    pagePointerPrefixAgreementOnly: true,
    pointerUrl: proof.pointer_url, pointerSha256: proof.pointer_sha256,
    url: record.mrf_url, fileSha256: record.retained_sha256,
    http_status: record.mrf_http_status, checked_at: record.observed_at,
    date: record.declared_date, version: record.declared_version,
    location_name: record.current_location_name,
    declared_hospital_name: record.declared_hospital_name,
    declared_address: record.declared_address, declared_license_state: record.declared_license_state,
    facility_state: 'MI', file_kind: 'csv',
    next_action: 'Validate the complete pointer-linked CSV and independently compare the price-page v=3 URL with pointer v=2 beyond the matching bounded prefixes; confirm current CCN enrollment if needed. This observed file-location result is not a legal compliance verdict.' };
  const entry = { ccn: record.ccn, base, action: 'replace', evidence,
    evidence_run: 'beacon-borgess-two-campus-transition-2026-09-17', reviewed_at: record.observed_at,
    note: `Beacon identifies ${record.current_location_name} as the former Borgess hospital at the exact roster campus. Its current root pointer links a separate identity-matched CSV with MI, 2026-01-01 and v3.0.0 in a bounded header. The pricing page links the same path with query v=3 rather than pointer v=2; their 262,144-byte prefixes match, but complete-file equivalence is unverified. The older Ascension-domain nonmatch remains historical. No full-file or legal verdict is inferred.` };
  const old = ledger.find(row => row.ccn === record.ccn);
  if (old) { if (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(evidence)) throw new Error(`Existing nonmatching ${record.ccn} resolution`); continue; }
  ledger.push(entry); applied.push(record.ccn);
}
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ applied }));
