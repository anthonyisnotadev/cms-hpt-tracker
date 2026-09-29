'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { requestCapped, extractDeclared, toISODate } = require('./lib/probe');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-vcu-medical-center-zip-proof.json'), 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  if (proof.ccn !== '490032' || proof.complete_file_validated !== false)
    throw new Error('VCU proof scope changed');
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === proof.ccn);
  if (!roster || `${roster.Address}, ${roster['City/Town']}, ${roster.State} ${roster['ZIP Code']}` !== proof.roster_address)
    throw new Error('VCU roster address changed');
  const pointer = fs.readFileSync(path.join(root, proof.retained_pointer_path), 'utf8');
  const entry = pointer.split(/(?=^location-name:)/m)
    .find(part => part.startsWith(`location-name: ${proof.pointer_location_name}`));
  const url = entry?.match(/^mrf-url:\s*(.+)$/m)?.[1]?.trim();
  const sourcePage = entry?.match(/^source-page-url:\s*(.+)$/m)?.[1]?.trim();
  if (sha(pointer) !== proof.retained_pointer_sha256 || !url || sha(url) !== proof.pointer_mrf_url_sha256
    || new URL(url).host !== proof.pointer_mrf_host || sourcePage !== proof.official_pricing_page)
    throw new Error('VCU exact pointer entry changed');
  const [livePointer, file, aliasPage, campusPage, pricingPage] = await Promise.all([
    requestCapped(proof.pointer_url, { cap: 65536, timeoutMs: 30000 }),
    requestCapped(url, { cap: proof.pointer_mrf_sample_bytes, timeoutMs: 30000,
      headers: { Range: `bytes=0-${proof.pointer_mrf_sample_bytes - 1}` } }),
    requestCapped(proof.official_alias_page, { cap: 262144, timeoutMs: 30000 }),
    requestCapped(proof.official_campus_page, { cap: 262144, timeoutMs: 30000 }),
    requestCapped(proof.official_pricing_page, { cap: 262144, timeoutMs: 30000 })
  ]);
  const meta = extractDeclared(file.body, proof.file_kind);
  const headerText = file.body.toString('utf8');
  const uniqueAddresses = new Set(String(meta.address || '').split('|').map(value => value.trim()));
  if (livePointer.status !== 200 || sha(livePointer.body) !== proof.retained_pointer_sha256
    || file.status !== proof.pointer_mrf_status || file.body.length !== proof.pointer_mrf_sample_bytes
    || Number(file.headers['content-length']) !== proof.pointer_mrf_reported_content_length
    || sha(file.body) !== proof.pointer_mrf_sample_sha256
    || new URL(file.finalUrl).host !== proof.pointer_mrf_final_host
    || meta.hospitalName !== proof.declared_hospital_name
    || meta.locationName !== proof.declared_location_name
    || meta.address !== proof.declared_address || uniqueAddresses.size !== 1
    || meta.licenseState !== proof.declared_license_state
    || toISODate(meta.raw) !== proof.declared_date || meta.version !== proof.declared_version
    || !headerText.includes(`"as_of_date": "${proof.declared_as_of_date}"`)
    || aliasPage.status !== 200 || !aliasPage.body.toString('utf8').includes('MCV Hospitals Authority')
    || campusPage.status !== 200 || !campusPage.body.toString('utf8').includes('1250 East Marshall Street')
    || !campusPage.body.toString('utf8').includes(proof.official_campus_zip)
    || pricingPage.status !== 200 || !pricingPage.body.toString('utf8').includes(new URL(url).pathname))
    throw new Error('VCU pointer, pages or bounded JSON header changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === proof.ccn);
  if (!base || base.finding !== 'not-assessed-site-unreachable')
    throw new Error('VCU base finding changed');
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'vcu-historical-mcv-alias-cms-ccn-current-first-party-campus-page-root-pointer-pricing-page-and-bounded-json-header-with-zip-variant',
    pointerUrl: proof.pointer_url,
    pointerSha256: proof.retained_pointer_sha256,
    location_name: proof.pointer_location_name,
    aliasPageUrl: proof.official_alias_page,
    aliasPageSha256: proof.official_alias_page_sha256,
    campusPageUrl: proof.official_campus_page,
    campusPageSha256: proof.official_campus_page_sha256,
    historicalCmsAliasUrl: proof.historical_cms_alias_source,
    sourcePageUrl: proof.official_pricing_page,
    sourcePageSha256: proof.official_pricing_page_sha256,
    url,
    sampleSha256: proof.pointer_mrf_sample_sha256,
    boundedSampleBytes: proof.pointer_mrf_sample_bytes,
    reportedContentLength: proof.pointer_mrf_reported_content_length,
    completeFileValidated: false,
    http_status: proof.pointer_mrf_status,
    checked_at: proof.observed_at,
    date: proof.declared_date,
    as_of_date: proof.declared_as_of_date,
    version: proof.declared_version,
    file_kind: proof.file_kind,
    declared_hospital_name: proof.declared_hospital_name,
    declared_location_name: proof.declared_location_name,
    declared_address: proof.declared_address,
    declared_license_state: proof.declared_license_state,
    roster_zip: '23298',
    publisher_file_zip: '23219',
    observedFinding: 'compliant-observed'
  };
  const existing = ledger.find(row => row.ccn === proof.ccn);
  if (existing) {
    if (existing.action !== 'replace' || JSON.stringify(existing.evidence) !== JSON.stringify(evidence))
      throw new Error('Existing nonmatching VCU resolution');
  } else {
    ledger.push({ ccn: proof.ccn, base, action: 'replace', evidence,
      finding: 'compliant-observed',
      note: 'VCU\'s history and a CMS CCN record link the roster\'s Medical College of Virginia Hospitals name to VCU Medical Center. The live root pointer and pricing page select a JSON file whose bounded header identifies VCU Medical Center at 1250 East Marshall Street, Richmond, VA, updated 2026-01-02 using version 3.0.0. The roster/current campus page use ZIP 23298; the file repeats ZIP 23219. Both source claims remain visible. The 648 MB file was sampled, not fully validated. This is a file-located observation, not a legal compliance or sibling-campus conclusion.',
      evidence_run: 'vcu-medical-center-zip-alias-review-2026-09-17', reviewed_at: proof.observed_at });
    ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: proof.ccn, finding: 'compliant-observed',
    roster_zip: '23298', publisher_file_zip: '23219', complete_file_validated: false }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
