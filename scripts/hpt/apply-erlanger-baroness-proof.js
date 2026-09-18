'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { requestCapped, extractDeclared, toISODate } = require('./lib/probe');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-erlanger-baroness-pointer-file-proof.json'), 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  if (proof.ccn !== '440104' || proof.complete_file_validated !== false)
    throw new Error('Erlanger proof scope changed');
  const pointer = fs.readFileSync(path.join(root, proof.retained_pointer_path), 'utf8');
  const entry = pointer.split(/(?=^location-name:)/m)
    .find(part => part.startsWith(`location-name: ${proof.pointer_location_name}`));
  const url = entry?.match(/^mrf-url:\s*(.+)$/m)?.[1]?.trim();
  const sourcePage = entry?.match(/^source-page-url:\s*(.+)$/m)?.[1]?.trim();
  if (sha(pointer) !== proof.retained_pointer_sha256 || !url || sha(url) !== proof.pointer_mrf_url_sha256
    || new URL(url).host !== proof.pointer_mrf_host || new URL(url).pathname !== proof.pointer_mrf_path
    || sourcePage !== proof.official_pricing_page)
    throw new Error('Erlanger exact pointer entry changed');
  const [file, page] = await Promise.all([
    requestCapped(url, { cap: proof.pointer_mrf_sample_bytes, timeoutMs: 30000,
      headers: { Range: `bytes=0-${proof.pointer_mrf_sample_bytes - 1}` } }),
    requestCapped(proof.official_pricing_page, { cap: 262144, timeoutMs: 30000 })
  ]);
  const meta = extractDeclared(file.body, proof.file_kind);
  if (file.status !== proof.pointer_mrf_status || file.body.length !== proof.pointer_mrf_sample_bytes
    || sha(file.body) !== proof.pointer_mrf_sample_sha256
    || Number(file.headers['content-length']) !== proof.pointer_mrf_reported_content_length
    || new URL(file.finalUrl).host !== proof.pointer_mrf_final_host
    || meta.hospitalName !== proof.declared_hospital_name
    || meta.locationName !== proof.declared_location_name
    || meta.address !== proof.declared_address
    || meta.licenseState !== proof.declared_license_state
    || toISODate(meta.raw) !== proof.declared_date || meta.version !== proof.declared_version
    || page.status !== proof.official_pricing_page_http_status
    || !page.body.toString('utf8').includes(proof.pointer_mrf_path)
    || !page.body.toString('utf8').includes(proof.pointer_location_name))
    throw new Error('Erlanger page or bounded file header changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === proof.ccn);
  if (!base || base.finding !== 'not-assessed-not-named-in-file')
    throw new Error('Erlanger base finding changed');
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'tennessee-state-alias-first-party-campus-root-pointer-pricing-page-and-exact-bounded-shared-csv-header',
    pointerUrl: proof.pointer_url,
    pointerSha256: proof.retained_pointer_sha256,
    location_name: proof.pointer_location_name,
    stateAliasUrl: proof.official_alias_source,
    campusPageUrl: proof.official_campus_source,
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
    version: proof.declared_version,
    file_kind: proof.file_kind,
    declared_hospital_name: proof.declared_hospital_name,
    declared_location_name: proof.declared_location_name,
    declared_address: proof.declared_address,
    declared_license_state: proof.declared_license_state,
    observedFinding: 'compliant-observed'
  };
  const existing = ledger.find(row => row.ccn === proof.ccn);
  if (existing) {
    if (existing.action !== 'replace' || JSON.stringify(existing.evidence) !== JSON.stringify(evidence))
      throw new Error('Existing nonmatching Erlanger resolution');
  } else {
    ledger.push({ ccn: proof.ccn, base, action: 'replace', evidence,
      finding: 'compliant-observed',
      note: 'Tennessee and the publisher identify Erlanger Medical Center as the Baroness campus at 975 East Third Street. Its first-party pointer and pricing page select the same shared CSV; the bounded header names Baroness, includes its exact campus address, Tennessee license state, 2026-01-25 date and version 3.0.0. The 1.95 GB file was sampled, not fully validated. This is a file-located observation, not a legal compliance conclusion or evidence for another Erlanger CCN.',
      evidence_run: 'erlanger-baroness-alias-review-2026-09-17', reviewed_at: proof.observed_at });
    ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: proof.ccn, finding: 'compliant-observed',
    complete_file_validated: false, sample_sha256: proof.pointer_mrf_sample_sha256 }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
