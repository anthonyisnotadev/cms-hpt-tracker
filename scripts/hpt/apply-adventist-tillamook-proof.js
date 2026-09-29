'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { requestCapped, extractDeclared, toISODate } = require('./lib/probe');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-adventist-tillamook-pointer-file-proof.json'), 'utf8'));
const pointerText = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/adventisthealth.org-666baf33640f.txt'), 'utf8');
const pointerEntry = pointerText.split(/(?=^location-name:)/m)
  .find(entry => entry.startsWith(`location-name: ${proof.pointer_location_name}`));
const fileUrl = pointerEntry?.match(/^mrf-url:\s*(.+)$/m)?.[1]?.trim();

async function main() {
  if (proof.ccn !== '381317' || !fileUrl
    || crypto.createHash('sha256').update(pointerText).digest('hex') !== proof.retained_pointer_sha256
    || crypto.createHash('sha256').update(fileUrl).digest('hex') !== proof.pointer_mrf_url_sha256
    || new URL(fileUrl).host !== proof.pointer_mrf_host
    || new URL(fileUrl).pathname !== proof.pointer_mrf_path
    || JSON.stringify([...new URL(fileUrl).searchParams.keys()]) !== JSON.stringify(proof.pointer_mrf_query_keys)
    || proof.complete_file_validated !== false)
    throw new Error('Tillamook pointer or proof changed');
  const sample = await requestCapped(fileUrl, { cap: proof.pointer_mrf_sample_bytes, timeoutMs: 30000,
    headers: { Range: `bytes=0-${proof.pointer_mrf_sample_bytes - 1}` } });
  const digest = crypto.createHash('sha256').update(sample.body).digest('hex');
  const metadata = extractDeclared(sample.body, 'csv');
  if (sample.status !== proof.pointer_mrf_bounded_get_status
    || sample.body.length !== proof.pointer_mrf_sample_bytes
    || digest !== proof.pointer_mrf_sample_sha256
    || metadata.hospitalName !== proof.declared_hospital_name
    || metadata.locationName !== proof.declared_location_name
    || metadata.address !== proof.declared_address
    || metadata.licenseState !== proof.declared_license_state
    || toISODate(metadata.raw) !== proof.declared_date
    || metadata.version !== proof.declared_version)
    throw new Error('Tillamook bounded file header changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === proof.ccn);
  if (!base || base.finding !== 'not-assessed-not-named-in-file') throw new Error('Tillamook base finding changed');
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'federal-legal-dba-first-party-address-exact-root-pointer-and-bounded-file-header',
    pointerUrl: proof.pointer_url,
    pointerSha256: proof.retained_pointer_sha256,
    pointerLocationName: proof.pointer_location_name,
    identityPageUrl: proof.federal_alias_source,
    addressPageUrl: proof.official_address_source,
    url: fileUrl,
    sampleSha256: proof.pointer_mrf_sample_sha256,
    boundedSampleBytes: proof.pointer_mrf_sample_bytes,
    extendedSampleBytes: proof.pointer_mrf_extended_sample_bytes,
    extendedSampleSha256: proof.pointer_mrf_extended_sample_sha256,
    completeFileValidated: false,
    http_status: proof.pointer_mrf_bounded_get_status,
    checked_at: proof.observed_at,
    date: proof.declared_date,
    version: proof.declared_version,
    location_name: proof.declared_location_name,
    declared_hospital_name: proof.declared_hospital_name,
    declared_address: proof.declared_address,
    declared_license_state: proof.declared_license_state,
    observedFinding: 'compliant-observed'
  };
  const existing = ledger.find(row => row.ccn === proof.ccn);
  if (existing) {
    if (existing.action !== 'replace' || JSON.stringify(existing.evidence) !== JSON.stringify(evidence))
      throw new Error('Existing nonmatching Tillamook resolution');
  } else {
    ledger.push({ ccn: proof.ccn, base, action: 'replace', evidence,
      finding: 'compliant-observed',
      note: 'The first-party pointer and bounded CSV header identify the exact Tillamook campus under its federally documented legal name, with an Oregon license state, 2026-05-22 declared update and CMS 3.0.0 version. This is a machine-readable-file-located observation, not complete-file validation or a legal compliance conclusion.',
      official: { domain: 'adventisthealth.org', page: proof.official_address_source },
      evidence_run: 'adventist-tillamook-alias-review-2026-09-17', reviewed_at: proof.observed_at });
    ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  }
  console.log(JSON.stringify({ applied: proof.ccn, finding: 'compliant-observed',
    complete_file_validated: false, pointer_sha256: proof.retained_pointer_sha256 }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
