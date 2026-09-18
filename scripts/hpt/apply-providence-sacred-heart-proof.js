'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { requestCapped, extractDeclared, toISODate } = require('./lib/probe');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-providence-sacred-heart-zip-proof.json'), 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  if (proof.ccn !== '500054' || proof.complete_file_validated !== false)
    throw new Error('Sacred Heart proof scope changed');
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === proof.ccn);
  if (!roster || `${roster.Address}, ${roster['City/Town']}, ${roster.State} ${roster['ZIP Code']}` !== proof.roster_address)
    throw new Error('Sacred Heart roster address changed');
  const pointer = fs.readFileSync(path.join(root, proof.retained_pointer_path), 'utf8');
  const entry = pointer.split(/(?=^location-name:)/m)
    .find(part => part.startsWith(`location-name: ${proof.pointer_location_name}`));
  const url = entry?.match(/^mrf-url:\s*(.+)$/m)?.[1]?.trim();
  const sourcePage = entry?.match(/^source-page-url:\s*(.+)$/m)?.[1]?.trim();
  if (sha(pointer) !== proof.retained_pointer_sha256 || !url || sha(url) !== proof.pointer_mrf_url_sha256
    || new URL(url).host !== proof.pointer_mrf_host || sourcePage !== proof.official_pricing_page)
    throw new Error('Sacred Heart exact pointer entry changed');
  const [livePointer, file, campusPage, pricingPage] = await Promise.all([
    requestCapped(proof.pointer_url, { cap: 65536, timeoutMs: 30000 }),
    requestCapped(url, { cap: proof.pointer_mrf_sample_bytes, timeoutMs: 30000,
      headers: { Range: `bytes=0-${proof.pointer_mrf_sample_bytes - 1}` } }),
    requestCapped(proof.official_campus_page, { cap: proof.official_campus_page_sample_bytes, timeoutMs: 30000 }),
    requestCapped(proof.official_pricing_page, { cap: 262144, timeoutMs: 30000 })
  ]);
  const meta = extractDeclared(file.body, proof.file_kind);
  if (livePointer.status !== 200 || sha(livePointer.body) !== proof.retained_pointer_sha256
    || file.status !== proof.pointer_mrf_status || file.body.length !== proof.pointer_mrf_sample_bytes
    || file.headers['content-range'] !== proof.pointer_mrf_content_range
    || sha(file.body) !== proof.pointer_mrf_sample_sha256
    || new URL(file.finalUrl).host !== proof.pointer_mrf_final_host
    || meta.hospitalName !== proof.declared_hospital_name
    || meta.locationName !== proof.declared_location_name
    || meta.address !== proof.declared_address || meta.licenseState !== proof.declared_license_state
    || toISODate(meta.raw) !== proof.declared_date || meta.version !== proof.declared_version
    || campusPage.status !== 200 || campusPage.body.length !== proof.official_campus_page_sample_bytes
    || !campusPage.body.toString('utf8').includes('101 W 8th Ave')
    || !campusPage.body.toString('utf8').includes(proof.official_campus_zip)
    || pricingPage.status !== 200 || !pricingPage.body.toString('utf8').includes(new URL(url).pathname))
    throw new Error('Sacred Heart pointer, page or bounded JSON header changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === proof.ccn);
  if (!base || base.finding !== 'not-assessed-not-named-in-file')
    throw new Error('Sacred Heart base finding changed');
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'cms-ccn-specific-facility-current-first-party-campus-page-root-pointer-pricing-page-and-bounded-json-header-with-roster-zip-variant',
    pointerUrl: proof.pointer_url,
    pointerSha256: proof.retained_pointer_sha256,
    location_name: proof.pointer_location_name,
    campusPageUrl: proof.official_campus_page,
    campusPageSampleSha256: proof.official_campus_page_sample_sha256,
    cmsCcnCampusUrl: proof.cms_ccn_campus_source,
    sourcePageUrl: proof.official_pricing_page,
    sourcePageSha256: proof.official_pricing_page_sha256,
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
    roster_zip: '99220',
    publisher_zip: '99204',
    observedFinding: 'compliant-observed'
  };
  const existing = ledger.find(row => row.ccn === proof.ccn);
  if (existing) {
    if (existing.action !== 'replace' || JSON.stringify(existing.evidence) !== JSON.stringify(evidence))
      throw new Error('Existing nonmatching Sacred Heart resolution');
  } else {
    ledger.push({ ccn: proof.ccn, base, action: 'replace', evidence,
      finding: 'compliant-observed',
      note: 'A CMS CCN-specific page and Providence\'s current campus page identify Sacred Heart Medical Center and Children\'s Hospital at 101 W 8th Ave, Spokane, WA 99204. The live root pointer and pricing page select a JSON file whose bounded header names that exact location, Washington state, a 2026-04-01 update and version 3.0.0. The imported CMS hospital roster says ZIP 99220 for the same street. Both source claims remain visible. The 219 MB file was sampled, not fully validated. This is a file-located observation, not a legal compliance conclusion.',
      evidence_run: 'providence-sacred-heart-zip-alias-review-2026-09-17', reviewed_at: proof.observed_at });
    ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: proof.ccn, finding: 'compliant-observed',
    roster_zip: '99220', publisher_zip: '99204', complete_file_validated: false }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
