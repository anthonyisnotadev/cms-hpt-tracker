'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { requestCapped, extractDeclared, toISODate } = require('./lib/probe');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-lexington-postal-zip-pointer-proof.json'), 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  if (proof.ccn !== '340096' || proof.complete_file_validated !== false)
    throw new Error('Lexington proof scope changed');
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === proof.ccn);
  if (!roster || `${roster.Address}, ${roster['City/Town']}, ${roster.State} ${roster['ZIP Code']}` !== proof.roster_address)
    throw new Error('Lexington roster address changed');
  const pointer = fs.readFileSync(path.join(root, proof.retained_pointer_path), 'utf8');
  const entry = pointer.split(/(?=^location-name:)/m)
    .find(part => part.startsWith(`location-name: ${proof.pointer_location_name}`));
  const url = entry?.match(/^mrf-url:\s*(.+)$/m)?.[1]?.trim();
  const sourcePage = entry?.match(/^source-page-url:\s*(.+)$/m)?.[1]?.trim();
  if (sha(pointer) !== proof.retained_pointer_sha256 || !url || sha(url) !== proof.pointer_mrf_url_sha256
    || new URL(url).host !== proof.pointer_mrf_host || sourcePage !== proof.official_pricing_page)
    throw new Error('Lexington exact pointer entry changed');
  const [livePointer, file, campusPage, pricingPage, npiResponse] = await Promise.all([
    requestCapped(proof.pointer_url, { cap: 65536, timeoutMs: 30000 }),
    requestCapped(url, { cap: proof.pointer_mrf_sample_bytes, timeoutMs: 30000,
      headers: { Range: `bytes=0-${proof.pointer_mrf_sample_bytes - 1}` } }),
    requestCapped(proof.official_campus_page, { cap: 262144, timeoutMs: 30000 }),
    requestCapped(proof.official_pricing_page, { cap: 262144, timeoutMs: 30000 }),
    requestCapped(proof.federal_npi_url, { cap: 65536, timeoutMs: 30000 })
  ]);
  const meta = extractDeclared(file.body, proof.file_kind);
  const npi = JSON.parse(npiResponse.body.toString('utf8'));
  const location = npi.results?.[0]?.addresses?.find(row => row.address_purpose === 'LOCATION');
  if (livePointer.status !== 200 || sha(livePointer.body) !== proof.retained_pointer_sha256
    || new URL(livePointer.finalUrl).host !== proof.pointer_final_host
    || file.status !== proof.pointer_mrf_status || file.body.length !== proof.pointer_mrf_sample_bytes
    || file.headers['content-range'] !== proof.pointer_mrf_content_range
    || sha(file.body) !== proof.pointer_mrf_sample_sha256
    || meta.hospitalName !== proof.declared_hospital_name
    || meta.locationName !== proof.declared_location_name
    || meta.address !== proof.declared_address || meta.licenseState !== proof.declared_license_state
    || toISODate(meta.raw) !== proof.declared_date || meta.version !== proof.declared_version
    || campusPage.status !== 200 || !campusPage.body.toString('utf8').includes('250 Hospital Drive')
    || !campusPage.body.toString('utf8').includes('27292')
    || pricingPage.status !== 200 || !pricingPage.body.toString('utf8').includes(new URL(url).pathname)
    || npiResponse.status !== 200 || npi.result_count !== 1
    || npi.results[0].basic.organization_name !== proof.federal_npi_legal_name
    || location?.address_1 !== '250 HOSPITAL DR' || location?.city !== 'LEXINGTON'
    || location?.state !== 'NC' || !location?.postal_code?.startsWith('27292'))
    throw new Error('Lexington pointer, page, NPI or bounded file header changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === proof.ccn);
  if (!base || base.finding !== 'not-assessed-not-named-in-file')
    throw new Error('Lexington base finding changed');
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'north-carolina-physical-campus-federal-npi-first-party-page-current-root-pointer-pricing-page-and-bounded-csv-header-with-roster-po-box-zip-variant',
    pointerUrl: proof.pointer_url,
    pointerSha256: proof.retained_pointer_sha256,
    location_name: proof.pointer_location_name,
    campusPageUrl: proof.official_campus_page,
    campusPageSha256: proof.official_campus_page_sha256,
    sourcePageUrl: proof.official_pricing_page,
    sourcePageSha256: proof.official_pricing_page_sha256,
    statePhysicalLocationUrl: proof.state_physical_location_source,
    identityPageUrl: proof.federal_npi_url,
    url,
    sampleSha256: proof.pointer_mrf_sample_sha256,
    boundedSampleBytes: proof.pointer_mrf_sample_bytes,
    reportedContentRange: proof.pointer_mrf_content_range,
    completeFileValidated: false,
    http_status: proof.pointer_mrf_status,
    checked_at: proof.observed_at,
    date: proof.declared_date,
    version: proof.declared_version,
    file_kind: proof.file_kind,
    declared_hospital_name: proof.declared_hospital_name,
    declared_location_name: proof.declared_location_name,
    declared_address: proof.declared_address,
    declared_license_state: proof.declared_license_state,
    roster_zip: '27293',
    publisher_zip: '27292',
    observedFinding: 'compliant-observed'
  };
  const existing = ledger.find(row => row.ccn === proof.ccn);
  if (existing) {
    if (existing.action !== 'replace' || JSON.stringify(existing.evidence) !== JSON.stringify(evidence))
      throw new Error('Existing nonmatching Lexington resolution');
  } else {
    ledger.push({ ccn: proof.ccn, base, action: 'replace', evidence,
      finding: 'compliant-observed',
      note: 'The live root pointer and first-party pricing page select Lexington Medical Center\'s CSV. Its bounded header names the exact 250 Hospital Drive campus in Lexington, NC, with 2025-10-08 date and version 3.0.0. The first-party hospital page, North Carolina physical-location record and federal NPI corroborate the 27292 physical ZIP; the imported CMS roster includes PO Box 1817 and ZIP 27293. The 2.14 GB file was sampled, not fully validated. This is a file-located observation, not a legal compliance conclusion.',
      evidence_run: 'lexington-postal-zip-alias-review-2026-09-17', reviewed_at: proof.observed_at });
    ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: proof.ccn, finding: 'compliant-observed',
    roster_zip: '27293', publisher_zip: '27292', complete_file_validated: false }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
