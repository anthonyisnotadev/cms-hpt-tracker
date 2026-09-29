'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { requestCapped, extractDeclared, toISODate } = require('./lib/probe');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-essentia-fargo-pointer-file-proof.json'), 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  if (proof.ccn !== '350070' || proof.complete_file_validated !== false)
    throw new Error('Fargo proof scope changed');
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === proof.ccn);
  if (!roster || `${roster.Address}, ${roster['City/Town']}, ${roster.State} ${roster['ZIP Code']}` !== proof.roster_address)
    throw new Error('Fargo roster address changed');
  const pointer = fs.readFileSync(path.join(root, proof.retained_pointer_path), 'utf8');
  const entry = pointer.split(/(?=^location-name:)/m)
    .find(part => part.startsWith(`location-name: ${proof.pointer_location_name}`));
  const url = entry?.match(/^mrf-url:\s*(.+)$/m)?.[1]?.trim();
  const sourcePage = entry?.match(/^source-page-url:\s*(.+)$/m)?.[1]?.trim();
  if (sha(pointer) !== proof.retained_pointer_sha256 || !url || sha(url) !== proof.pointer_mrf_url_sha256
    || new URL(url).host !== proof.pointer_mrf_host || new URL(url).pathname !== proof.pointer_mrf_path
    || sourcePage !== proof.official_pricing_page)
    throw new Error('Fargo exact pointer entry changed');
  const [file, hospitalPage, pricingPage] = await Promise.all([
    requestCapped(url, { cap: proof.pointer_mrf_sample_bytes, timeoutMs: 30000,
      headers: { Range: `bytes=0-${proof.pointer_mrf_sample_bytes - 1}` } }),
    requestCapped(proof.official_hospital_page, { cap: 262144, timeoutMs: 30000 }),
    requestCapped(proof.official_pricing_page, { cap: 262144, timeoutMs: 30000 })
  ]);
  const meta = extractDeclared(file.body, proof.file_kind);
  const hospitalHtml = hospitalPage.body.toString('utf8');
  const pricingHtml = pricingPage.body.toString('utf8');
  if (file.status !== proof.pointer_mrf_status || file.body.length !== proof.pointer_mrf_sample_bytes
    || sha(file.body) !== proof.pointer_mrf_sample_sha256
    || file.headers['content-range'] !== proof.pointer_mrf_reported_content_range
    || meta.hospitalName !== proof.declared_hospital_name
    || meta.locationName !== proof.declared_location_name
    || meta.address !== proof.declared_address
    || meta.licenseState !== proof.declared_license_state
    || toISODate(meta.raw) !== proof.declared_date || meta.version !== proof.declared_version
    || hospitalPage.status !== proof.official_hospital_page_http_status
    || pricingPage.status !== proof.official_pricing_page_http_status
    || !hospitalHtml.includes('3000 32nd Ave S') || !hospitalHtml.includes('58103')
    || !hospitalHtml.includes(proof.pointer_mrf_path)
    || !pricingHtml.includes(proof.pointer_mrf_path))
    throw new Error('Fargo page or bounded file header changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === proof.ccn);
  if (!base || base.finding !== 'not-assessed-domain-unknown')
    throw new Error('Fargo base finding changed');
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'exact-first-party-hospital-page-root-pointer-pricing-page-and-bounded-csv-header-with-roster-zip-difference',
    pointerUrl: proof.pointer_url,
    pointerSha256: proof.retained_pointer_sha256,
    location_name: proof.pointer_location_name,
    hospitalPageUrl: proof.official_hospital_page,
    hospitalPageSha256: proof.official_hospital_page_sha256,
    sourcePageUrl: proof.official_pricing_page,
    sourcePageSha256: proof.official_pricing_page_sha256,
    url,
    sampleSha256: proof.pointer_mrf_sample_sha256,
    boundedSampleBytes: proof.pointer_mrf_sample_bytes,
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
    roster_zip: '58104',
    publisher_zip: '58103',
    observedFinding: 'compliant-observed'
  };
  const existing = ledger.find(row => row.ccn === proof.ccn);
  if (existing) {
    if (existing.action !== 'replace' || JSON.stringify(existing.evidence) !== JSON.stringify(evidence))
      throw new Error('Existing nonmatching Fargo resolution');
  } else {
    ledger.push({ ccn: proof.ccn, base, action: 'replace', evidence,
      finding: 'compliant-observed',
      note: 'The exact Essentia Fargo root-pointer target and first-party pricing page link the same CSV. Its bounded header names Fargo Hospital at 3000 32nd Ave S, Fargo, ND 58103, with North Dakota state, 2026-01-01 date and version 3.0.0; the current hospital page independently agrees. The imported CMS roster says ZIP 58104 for the same street. This is a file-located observation with the roster/publisher ZIP difference preserved, not complete-file validation or a legal compliance conclusion.',
      evidence_run: 'essentia-fargo-roster-zip-alias-review-2026-09-17', reviewed_at: proof.observed_at });
    ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: proof.ccn, finding: 'compliant-observed',
    roster_zip: '58104', publisher_zip: '58103', complete_file_validated: false }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
