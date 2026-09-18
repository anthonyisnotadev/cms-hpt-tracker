'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { requestCapped, extractDeclared, toISODate } = require('./lib/probe');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-perimeter-jackson-license-state-proof.json'), 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  if (proof.ccn !== '444023' || proof.full_file_schema_and_rate_validity_assessed !== false)
    throw new Error('Jackson proof scope changed');
  const pointer = fs.readFileSync(path.join(root, proof.retained_pointer_path), 'utf8');
  const entry = pointer.split(/(?=^location-name:)/m)
    .find(part => part.startsWith(`location-name: ${proof.pointer_location_name}`));
  const url = entry?.match(/^mrf-url:\s*(.+)$/m)?.[1]?.trim();
  const page = entry?.match(/^source-page-url:\s*(.+)$/m)?.[1]?.trim();
  if (sha(pointer) !== proof.retained_pointer_sha256 || !url
    || sha(url) !== proof.pointer_mrf_url_sha256 || page !== proof.pointer_source_page)
    throw new Error('Jackson exact pointer entry changed');
  const [file, npiResponse] = await Promise.all([
    requestCapped(url, { cap: 65536, timeoutMs: 30000 }),
    requestCapped(proof.federal_npi_url, { cap: 65536, timeoutMs: 30000 })
  ]);
  const metadata = extractDeclared(file.body, 'csv');
  const npi = JSON.parse(npiResponse.body.toString('utf8'));
  const provider = npi.results?.[0];
  const location = provider?.addresses?.find(a => a.address_purpose === 'LOCATION');
  if (file.status !== proof.file_http_status || file.body.length !== proof.file_bytes
    || Number(file.headers['content-length']) !== proof.file_content_length
    || sha(file.body) !== proof.file_sha256
    || metadata.hospitalName !== proof.declared_hospital_name
    || metadata.locationName !== proof.declared_location_name
    || metadata.address !== proof.declared_address
    || toISODate(metadata.raw) !== proof.declared_date
    || metadata.version !== proof.declared_version
    || metadata.licenseState !== proof.declared_license_state_header
    || !file.body.toString('utf8').includes('license_L000000037711 | TN')
    || npiResponse.status !== 200 || npi.result_count !== 1
    || provider.basic.organization_name !== proof.federal_legal_name
    || !provider.other_names?.some(n => n.organization_name === proof.federal_dba)
    || `${location?.address_1}, ${location?.city}, ${location?.state} ${location?.postal_code?.slice(0, 5)}` !== proof.federal_location)
    throw new Error('Jackson file or federal identity proof changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === proof.ccn);
  if (!base || base.finding !== 'not-assessed-not-named-in-file')
    throw new Error('Jackson base finding changed');
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'federal-legal-dba-current-first-party-campus-exact-root-pointer-and-complete-csv-with-license-state-header-conflict',
    pointerUrl: proof.pointer_url,
    pointerSha256: proof.retained_pointer_sha256,
    location_name: proof.pointer_location_name,
    sourcePageUrl: proof.pointer_source_page,
    identityPageUrl: proof.federal_npi_url,
    stateAliasUrl: proof.state_alias_source,
    url,
    fileSha256: proof.file_sha256,
    fullFileBytes: proof.file_bytes,
    http_status: proof.file_http_status,
    checked_at: proof.observed_at,
    date: proof.declared_date,
    version: proof.declared_version,
    file_kind: proof.file_kind,
    declared_hospital_name: proof.declared_hospital_name,
    declared_address: proof.declared_address,
    declared_license_state: proof.declared_license_state_header,
    declared_license_value_state: proof.declared_license_state_value,
    facility_state: proof.facility_state,
    fullFileRetrieved: true,
    fullFileSchemaAndRateValidityAssessed: false,
    observedFinding: 'mrf-license-state-field-conflicts-facility'
  };
  const existing = ledger.find(row => row.ccn === proof.ccn);
  if (existing) {
    if (existing.action !== 'replace-observation' || JSON.stringify(existing.evidence) !== JSON.stringify(evidence))
      throw new Error('Existing nonmatching Jackson resolution');
  } else {
    ledger.push({ ccn: proof.ccn, base, action: 'replace-observation', evidence,
      evidence_run: 'perimeter-jackson-license-state-alias-review-2026-09-17',
      reviewed_at: proof.observed_at,
      note: 'The root pointer names Woodridge of West Tennessee LLC and its complete 3,687-byte CSV identifies the Jackson campus at 49 Old Hickory Boulevard. Federal NPI and state records corroborate that legal-name alias. The CSV header declares license_number | TX, while its license value ends in | TN and the campus is in Tennessee. This is a file-located observation with an explicit publisher-field conflict, not a full rate/schema audit or legal compliance determination.' });
    ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: proof.ccn, finding: evidence.observedFinding,
    file_sha256: proof.file_sha256, full_file_schema_and_rate_validity_assessed: false }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
