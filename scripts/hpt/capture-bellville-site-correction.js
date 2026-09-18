'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const { curlGet, sha } = require('./lib/recovery-transport');
const { requestCapped, extractDeclared } = require('./lib/probe');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '450253';
const facilityUrl = 'https://midcoasthealthsystem.org/mcmc-bellville/';
const pricingUrl = 'https://midcoasthealthsystem.org/pricing-transparency/';
const pointerUrl = 'https://midcoasthealthsystem.org/cms-hpt.txt';
const proofName = 'reconciliation-bellville-site-correction-proof.json';

async function getPage(url, cap) {
  const r = await curlGet(url, cap, 30000, 6, {}, false);
  if (r.status !== 200 || !r.body.length) throw new Error(`First-party source unavailable: ${url}`);
  return r;
}

async function main() {
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  const facility = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .find(row => row.ccn === ccn);
  const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8')).records
    .find(row => row.ccn === ccn);
  const oldPointer = fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/raw/sjhsyr.org-3b7c3639dfd7.txt'));
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const observationsPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const observations = JSON.parse(fs.readFileSync(observationsPath, 'utf8'));
  if (!base || base.finding !== 'not-assessed-not-named-in-file'
    || base.domain !== 'sjhsyr.org' || base.pointer_url !== 'https://www.sjhsyr.org/cms-hpt.txt'
    || !facility || facility.name !== 'BELLVILLE MEDICAL CENTER'
    || facility.address !== '44 N CUMMINGS ST' || facility.city !== 'BELLVILLE'
    || facility.state !== 'TX' || facility.zip !== '77418'
    || verification?.pointer_corpus_sha256 !== sha(oldPointer)
    || /bellville|texas|77418/i.test(oldPointer.toString('utf8'))
    || !oldPointer.toString('utf8').includes('St Josephs Hospital Health Ctr')
    || ledger.some(row => row.ccn === ccn) || observations.records.some(row => row.ccn === ccn)
    || fs.existsSync(path.join(audit, proofName)))
    throw new Error('Bellville base, wrong pointer, or existing review changed');

  const [identity, pricing, pointer] = await Promise.all([
    getPage(facilityUrl, 262144), getPage(pricingUrl, 262144), getPage(pointerUrl, 16384),
  ]);
  const identityText = identity.body.toString('utf8');
  const pointerText = pointer.body.toString('utf8');
  const entry = pointerText.split(/\r?\n\s*\r?\n/).find(block =>
    /^location-name:\s*Bellville Medical Center\s*$/im.test(block));
  const fileWrapperUrl = entry?.match(/^mrf_url:\s*(\S+)/im)?.[1];
  const decodedFileUrl = fileWrapperUrl && new URL(fileWrapperUrl).searchParams.get('a');
  const sourceWrapperUrl = entry?.match(/^source-page_url:\s*(\S+)/im)?.[1];
  const decodedSourceUrl = sourceWrapperUrl && new URL(sourceWrapperUrl).searchParams.get('a');
  const doc = cheerio.load(pricing.body.toString('utf8'));
  const bellvilleHeading = doc('h4').filter((_, element) =>
    doc(element).text().includes('Mid Coast Medical Center - Bellville')).first();
  const bellvillePageLinks = ['TallCSV', 'WideCSV'].map(label => {
    const anchor = doc('a').filter((_, element) => doc(element).text().trim() === label).eq(1);
    return { label, host: new URL(anchor.attr('href')).hostname,
      href_sha256: sha(anchor.attr('href')) };
  });
  if (!/44 N Cummings St, Bellville, TX 77418/i.test(identityText)
    || !identityText.includes('In 2023, this hospital facility located in Bellville')
    || !bellvilleHeading.length || bellvillePageLinks.some(link => link.host !== 'public.boxcloud.com')
    || !entry || !fileWrapperUrl || !sourceWrapperUrl
    || decodedSourceUrl !== pricingUrl
    || decodedFileUrl !== 'https://app.box.com/shared/static/3mydfralbd8qx0h8vqu7j9wbf4ps63x7.csv')
    throw new Error('Current Bellville site, pricing page or pointer entry changed');

  const sample = await requestCapped(fileWrapperUrl, { cap: 262144, timeoutMs: 30000,
    headers: { Range: 'bytes=0-262143' } });
  const metadata = extractDeclared(sample.body, 'csv');
  if (![200, 206].includes(sample.status) || sample.body.length !== 262144
    || metadata.hospitalName !== 'Bellville Medical Center'
    || metadata.locationName !== 'Bellville Medical Center'
    || metadata.address !== '44 North Cummings St , Bellville, TX 77418'
    || metadata.licenseState !== 'TX'
    || metadata.raw !== '2025-06-01' || metadata.version !== '2.0.0')
    throw new Error('Pointer-declared Bellville file header changed');

  const observedAt = new Date().toISOString();
  const proof = {
    ccn, observed_at: observedAt, roster_name: facility.name,
    roster_address: facility.address, roster_city: facility.city,
    roster_state: facility.state, roster_zip: facility.zip,
    old_assigned_domain: base.domain, old_pointer_url: base.pointer_url,
    old_pointer_sha256: sha(oldPointer), old_pointer_location_names: ['St Josephs Hospital Health Ctr'],
    official_domain: 'midcoasthealthsystem.org', facility_url: facilityUrl,
    facility_http_status: identity.status, facility_sha256: sha(identity.body),
    pricing_url: pricingUrl, pricing_http_status: pricing.status, pricing_sha256: sha(pricing.body),
    bellville_page_download_leads: bellvillePageLinks,
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_sha256: sha(pointer.body), pointer_location_name: 'Bellville Medical Center',
    pointer_source_url_sha256: sha(sourceWrapperUrl), decoded_source_url: decodedSourceUrl,
    pointer_file_url_sha256: sha(fileWrapperUrl), decoded_file_url: decodedFileUrl,
    pointer_file_sample_http_status: sample.status, pointer_file_sample_bytes: sample.body.length,
    pointer_file_sample_sha256: sha(sample.body), file_declared_name: metadata.hospitalName,
    file_declared_location: metadata.locationName, file_declared_address: metadata.address,
    file_declared_license_state: metadata.licenseState, file_declared_update: metadata.raw,
    file_declared_version: metadata.version,
    limitation: 'The first-party pointer has a Bellville-specific link through a URL-protection wrapper to a readable 262144-byte CSV prefix. The file declares a 2025-06-01 date and v2.0.0, but this is not complete-file validation or a legal compliance verdict. The current pricing page has separate BoxCloud download leads; their complete bytes and relationship to the pointer file were not established. Wrapper and ephemeral download URLs are not copied into public artifacts.',
  };
  const nextAction = 'The Texas hospital domain and Bellville-specific root pointer are now identified. Reconcile the dated v2.0.0 pointer CSV against the pricing page’s distinct BoxCloud leads and obtain complete-file access before a current file finding. Do not reuse the unrelated New York St Josephs pointer; preserve its assignment as history.';
  const evidence = {
    identityPageUrl: facilityUrl, identityPageSha256: proof.facility_sha256,
    facilityName: 'Mid Coast Medical Center - Bellville',
    facilityAddress: '44 N Cummings St, Bellville, TX 77418', facilityState: 'TX',
    rootPointerUrl: pointerUrl, rootPointerHttpStatus: 200,
    rootPointerResponseKind: 'structured-facility-pointer',
    rootPointerSha256: proof.pointer_sha256,
    rootPointerLocationName: proof.pointer_location_name,
    rootPointerFileTargetSha256: proof.pointer_file_url_sha256,
    rootPointerFileHeaderName: proof.file_declared_name,
    rootPointerFileHeaderAddress: proof.file_declared_address,
    rootPointerFileHeaderState: proof.file_declared_license_state,
    decodedFileUrl: decodedFileUrl, pointerFileSampleSha256: proof.pointer_file_sample_sha256,
    pointerFileSampleBytes: proof.pointer_file_sample_bytes,
    sourcePageUrl: pricingUrl, sourcePageSha256: proof.pricing_sha256,
    checked_at: observedAt, next_action: nextAction,
  };
  fs.writeFileSync(path.join(audit, proofName), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'correct-site', official: { domain: 'midcoasthealthsystem.org' },
    evidence, evidence_run: 'bellville-correct-domain-review-2026-09-17', reviewed_at: observedAt,
    note: 'The old New York St Josephs pointer has no Bellville entry. The first-party Mid Coast Bellville page names the exact Texas roster campus, and its root pointer has a Bellville-specific entry whose bounded CSV header names that campus and Texas. The pointer file declares 2025-06-01 and v2.0.0; current page download leads are distinct and not yet fully reconciled. Correct the site attribution only, preserving the prior pointer as history and withholding a current MRF finding.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  observations.records.push({ ccn, observed_at: observedAt, proof_file: proofName,
    official_facility_page: facilityUrl, official_pricing_page: pricingUrl,
    official_pointer_url: pointerUrl, decoded_pointer_file_url: decodedFileUrl,
    pointer_file_sample_sha256: proof.pointer_file_sample_sha256,
    disposition: 'wrong-cross-state-pointer-corrected-file-metadata-review-pending',
    next_action: nextAction });
  observations.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(observationsPath, JSON.stringify(observations, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, corrected_domain: 'midcoasthealthsystem.org',
    pointer_sha256: proof.pointer_sha256, file_sample_sha256: proof.pointer_file_sample_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
