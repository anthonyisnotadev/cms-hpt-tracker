'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const artifact = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-nmhs-pointer-mismatch-proofs.json'), 'utf8'));
const bases = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).map(row => [row.ccn, row]));
const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const expected = new Set(['250002', '250004']);
if (artifact.records.length !== expected.size || new Set(artifact.records.map(row => row.ccn)).size !== expected.size) {
  throw new Error('Unexpected NMHS proof cohort');
}
const entries = artifact.records.map(row => {
  const base = bases.get(row.ccn);
  const sample = fs.readFileSync(path.join(root, row.retained_sample));
  if (!expected.has(row.ccn) || !base || base.finding !== 'mrf-url-unreachable'
      || base.domain !== 'nmhs.net' || row.pointer_http_status !== 206
      || row.pointer_mrf_http_status !== 404 || row.current_mrf_http_status !== 206
      || row.pointer_mrf_url === row.current_mrf_url || row.retained_bytes !== 262144
      || sample.length !== row.retained_bytes
      || crypto.createHash('sha256').update(sample).digest('hex') !== row.current_mrf_sha256
      || row.declared_state !== 'MS' || row.declared_date !== '2026-04-01'
      || row.version !== '3.0.0') throw new Error(`Incomplete NMHS proof for ${row.ccn}`);
  const evidence = {
    identity: 'corroborated',
    identity_basis: row.ccn === '250002'
      ? 'official-pricing-page-file-header-exact-address-state-and-first-party-iuka-dba-mapping'
      : 'official-pricing-page-facility-page-and-file-header-exact-name-street-city-state',
    pointerUrl: row.pointer_url, pointerSha256: row.pointer_sha256,
    pointerHttpStatus: row.pointer_http_status, pointerMrfUrl: row.pointer_mrf_url,
    pointerMrfHttpStatus: row.pointer_mrf_http_status,
    url: row.current_mrf_url, fileSha256: row.current_mrf_sha256,
    http_status: row.current_mrf_http_status, checked_at: row.observed_at,
    date: row.declared_date, version: row.version, officialDomain: row.official_domain,
    location_name: row.declared_location_name, declared_hospital_name: row.declared_hospital_name,
    declared_address: row.declared_address, declared_license_state: row.declared_state,
    file_kind: 'json', sourcePageUrl: row.source_page_url, sourcePageSha256: row.source_page_sha256,
    officialIdentityUrl: row.official_identity_url, officialIdentitySha256: row.official_identity_sha256,
    ...(row.corporate_mapping_url ? { corporateMappingUrl: row.corporate_mapping_url,
      corporateMappingSha256: row.corporate_mapping_sha256 } : {}),
    observedFinding: 'pointer-links-unavailable-mrf-source-page-current-file',
    pointerIssue: 'pointer-mrf-http-error-current-source-page-file', next_action: row.next_action,
  };
  return { ccn: row.ccn, base, action: 'replace-observation', evidence,
    evidence_run: `nmhs-pointer-file-mismatch-2026-09-16-${row.ccn}`, reviewed_at: row.observed_at,
    note: `The current NMHS root pointer names ${row.declared_hospital_name} but its exact declared JSON returns HTTP 404. The first-party pricing page separately links a different JSON whose retained header identifies the matching ${row.declared_address} campus, Mississippi license state, ${row.declared_date} date and CMS ${row.version}. The official facility page${row.ccn === '250002' ? ' and first-party corporate DBA statement' : ''} corroborate the location. This is a current page-linked file, not a working pointer-linked file or compliance conclusion.` };
});
for (const entry of entries) {
  const old = ledger.find(row => row.ccn === entry.ccn);
  if (old && (old.evidence_run !== entry.evidence_run || JSON.stringify(old.evidence) !== JSON.stringify(entry.evidence))) {
    throw new Error(`Existing nonmatching NMHS resolution ${entry.ccn}`);
  }
}
const additions = entries.filter(entry => !ledger.some(row => row.ccn === entry.ccn));
if (additions.length) {
  ledger.push(...additions); ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
console.log(JSON.stringify({ applied: additions.map(row => row.ccn), already_present: entries.length - additions.length }));
