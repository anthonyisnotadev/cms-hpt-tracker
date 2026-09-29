'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const { curlGet, retrieve, sha } = require('./lib/recovery-transport');
const { requestCapped, extractDeclared } = require('./lib/probe');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '451396';
const homeUrl = 'https://llanoregional.org/';
const transitionUrl = 'https://llanoregional.org/news/press-release-llano-hospital-rebrands-under-local-leadership-for-a-stronger-future/';
const priceUrl = 'https://llanoregional.org/Price-Transparency/';
const pointerUrl = 'https://llanoregional.org/cms-hpt.txt';
const enrollmentUrl = 'https://data.cms.gov/data-api/v1/dataset/3b5eae55-981c-4358-b3f8-7032d053d893/data?filter%5BCCN%5D=451396&size=10';
const proofName = 'reconciliation-llano-regional-current-proof.json';

async function get(url, cap) {
  const response = await curlGet(url, cap, 30000, 6, {}, false);
  if (response.status !== 200 || !response.body.length
      || Number(response.headers['content-length'] || response.body.length) > cap)
    throw new Error(`Incomplete source ${url}: ${response.status}, ${response.body.length} bytes`);
  return response;
}

async function main() {
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .find(row => row.ccn === ccn);
  const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8')).records
    .find(row => row.ccn === ccn);
  const oldPointer = fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/raw/bswhealth.com-bf1d46551255.txt'));
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (!base || base.finding !== 'not-assessed-not-named-in-file'
      || base.domain !== 'bswhealth.com' || base.pointer_url !== 'https://bswhealth.com/cms-hpt.txt'
      || !roster || roster.name !== 'MID COAST MEDICAL CENTER - CENTRAL'
      || roster.address !== '200 W OLLIE' || roster.city !== 'LLANO'
      || roster.state !== 'TX' || roster.zip !== '78643'
      || verification?.pointer_corpus_sha256 !== sha(oldPointer)
      || /\bllano\b|\bollie\b|\bmid\s*coast\b/i.test(oldPointer.toString('utf8'))
      || ledger.some(row => row.ccn === ccn)
      || fs.existsSync(path.join(audit, proofName)))
    throw new Error('Llano source or existing review changed');

  const [home, transition, price, pointer, enrollmentResponse] = await Promise.all([
    get(homeUrl, 262144), get(transitionUrl, 262144), get(priceUrl, 262144),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }), get(enrollmentUrl, 16384),
  ]);
  const enrollmentRows = JSON.parse(enrollmentResponse.body.toString('utf8'));
  const enrollment = enrollmentRows[0];
  const homeText = cheerio.load(home.body.toString('utf8')).text();
  const transitionText = cheerio.load(transition.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const priceDocument = cheerio.load(price.body.toString('utf8'));
  const pointerText = pointer.body.toString('utf8');
  const safePointerLines = pointerText.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^location-name:/i.test(line));
  const wrapperFileUrl = pointerText.match(/^mrf-url:\s*(\S+)/im)?.[1];
  const wrapperSourceUrl = pointerText.match(/^source-page-url:\s*(\S+)/im)?.[1];
  const decodedFileUrl = wrapperFileUrl && new URL(wrapperFileUrl).searchParams.get('a');
  const decodedSourceUrl = wrapperSourceUrl && new URL(wrapperSourceUrl).searchParams.get('a');
  const standardLinks = priceDocument('a').filter((_, element) =>
    priceDocument(element).text().trim() === 'Standard Charges')
    .map((_, element) => priceDocument(element).attr('href')).get();
  if (pointer.status !== 200 || pointer.headers['content-type'] !== 'text/plain'
      || safePointerLines.join('|') !== 'location-name: Llano Regional Hospital'
      || !wrapperFileUrl || !wrapperSourceUrl
      || decodedFileUrl !== 'https://app.box.com/shared/static/014qldrhzg4gzylftskt3wtnjfulb9id.csv'
      || !decodedSourceUrl || !standardLinks.includes(decodedSourceUrl)
      || !homeText.includes('200 W Ollie Street')
      || !transitionText.includes('MidCoast Medical Center – Central Llano becomes Llano Regional Hospital')
      || !transitionText.includes('will no longer be part of the MidCoast Health System')
      || !transitionText.includes('200 W. Ollie Street')
      || !priceDocument.text().includes('Llano Regional Hospital')
      || enrollmentRows.length !== 1 || enrollment.CCN !== ccn
      || enrollment['ORGANIZATION NAME'] !== 'LLANO REGIONAL HOSPITAL'
      || enrollment['PROVIDER TYPE TEXT'] !== 'PART A PROVIDER - CRITICAL ACCESS HOSPITAL'
      || enrollment.NPI !== '1326349986'
      || enrollment['ADDRESS LINE 1'] !== '200 W OLLIE ST'
      || enrollment.CITY !== 'LLANO' || enrollment.STATE !== 'TX'
      || !String(enrollment['ZIP CODE']).startsWith('78643'))
    throw new Error('Current Llano identity, transition, pointer, page or CMS enrollment changed');

  const [sample, directSample, full] = await Promise.all([
    requestCapped(wrapperFileUrl, { cap: 262144, timeoutMs: 30000,
      headers: { Range: 'bytes=0-262143' } }),
    requestCapped(decodedFileUrl, { cap: 262144, timeoutMs: 30000,
      headers: { Range: 'bytes=0-262143' } }),
    requestCapped(wrapperFileUrl, { cap: 3 * 1024 * 1024, timeoutMs: 30000 }),
  ]);
  const metadata = extractDeclared(full.body.subarray(0, 262144), 'csv');
  if (sample.status !== 206 || directSample.status !== 206
      || sample.body.length !== 262144 || directSample.body.length !== 262144
      || sha(sample.body) !== sha(directSample.body)
      || full.status !== 200 || full.body.length !== 2603792
      || Number(full.headers['content-length']) !== full.body.length
      || sha(full.body.subarray(0, 262144)) !== sha(sample.body)
      || metadata.hospitalName !== 'Llano Regional Hospital'
      || metadata.locationName !== 'Llano Regional Hospital'
      || metadata.address !== '200 W Ollie St , Llano, TX 78643'
      || metadata.licenseState !== 'TX'
      || metadata.raw !== '3/1/2026' || metadata.version !== '3.0.0')
    throw new Error('Llano pointer file access, identity, date, version or wrapper equivalence changed');

  const observedAt = new Date().toISOString();
  const proof = {
    ccn, observed_at: observedAt, roster_name: roster.name,
    roster_address: roster.address, roster_city: roster.city,
    roster_state: roster.state, roster_zip: roster.zip,
    old_assigned_domain: base.domain, old_pointer_url: base.pointer_url,
    old_pointer_sha256: sha(oldPointer), old_pointer_has_llano_campus: false,
    current_name: 'Llano Regional Hospital', current_domain: 'llanoregional.org',
    home_url: homeUrl, home_sha256: sha(home.body),
    first_party_transition_url: transitionUrl, transition_sha256: sha(transition.body),
    transition_effective_date: '2025-04-01',
    pricing_page_url: priceUrl, pricing_page_sha256: sha(price.body),
    pricing_page_links_pointer_source_target: true,
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_sha256: sha(pointer.body), pointer_location_name: 'Llano Regional Hospital',
    pointer_file_wrapper_sha256: sha(wrapperFileUrl), decoded_file_url: decodedFileUrl,
    pointer_source_wrapper_sha256: sha(wrapperSourceUrl), decoded_source_url: decodedSourceUrl,
    pointer_wrapper_sample_status: sample.status, pointer_wrapper_sample_bytes: sample.body.length,
    pointer_wrapper_sample_sha256: sha(sample.body), decoded_target_sample_sha256: sha(directSample.body),
    full_file_http_status: full.status, full_file_bytes: full.body.length,
    full_file_sha256: sha(full.body), full_file_line_breaks: full.body.toString('utf8').split(/\r?\n/).length - 1,
    file_declared_name: metadata.hospitalName, file_declared_location: metadata.locationName,
    file_declared_address: metadata.address, file_declared_license_state: metadata.licenseState,
    file_declared_update_raw: metadata.raw, file_declared_update: '2026-03-01',
    file_declared_version: metadata.version,
    cms_enrollment_url: enrollmentUrl, cms_enrollment_response_sha256: sha(enrollmentResponse.body),
    cms_enrollment: { ccn: enrollment.CCN, organization_name: enrollment['ORGANIZATION NAME'],
      npi: enrollment.NPI, provider_type: enrollment['PROVIDER TYPE TEXT'],
      address: enrollment['ADDRESS LINE 1'], city: enrollment.CITY, state: enrollment.STATE,
      zip: enrollment['ZIP CODE'] },
    limitation: 'The current hospital, CMS enrollment, root pointer, page-linked source target and complete CSV agree on facility identity and root metadata. The pointer URL is a public URL-protection wrapper; only its SHA-256 and the decoded static Box target are retained. This is not line-item CMS validation or a legal compliance verdict.',
  };
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'first-party-former-name-transition-cms-current-enrollment-root-pointer-page-source-and-complete-csv-name-address-state',
    pointerUrl, pointerSha256: proof.pointer_sha256,
    pointerMrfWrapperSha256: proof.pointer_file_wrapper_sha256,
    decodedPointerMrfUrl: decodedFileUrl,
    pointerMrfSampleSha256: proof.pointer_wrapper_sample_sha256,
    decodedTargetSampleSha256: proof.decoded_target_sample_sha256,
    pointerFileResponseSha256: proof.full_file_sha256,
    url: decodedFileUrl, fileSha256: proof.full_file_sha256,
    fullFileBytes: proof.full_file_bytes, http_status: proof.full_file_http_status,
    checked_at: observedAt, date: proof.file_declared_update, version: proof.file_declared_version,
    officialDomain: 'llanoregional.org', location_name: proof.file_declared_location,
    declared_hospital_name: proof.file_declared_name,
    declared_address: proof.file_declared_address,
    declared_license_state: proof.file_declared_license_state,
    file_kind: 'csv', sourcePageUrl: priceUrl, sourcePageSha256: proof.pricing_page_sha256,
    publisherSourceUrl: decodedSourceUrl,
    identityPageUrl: transitionUrl, identityPageSha256: proof.transition_sha256,
    cmsEnrollmentUrl: enrollmentUrl, cmsEnrollmentSha256: proof.cms_enrollment_response_sha256,
  };
  ledger.push({ ccn, base, action: 'replace', evidence,
    evidence_run: 'llano-regional-current-complete-file-review-2026-09-17', reviewed_at: observedAt,
    note: 'Llano Regional first-party material explicitly identifies the former MidCoast Central Llano name and same 200 W Ollie campus, effective 2025-04-01. Current CMS enrollment agrees on critical-access CCN 451396 and the address. The current Llano root pointer and pricing page link the same source target; its wrapper and decoded Box path returned identical bounded bytes, and the complete 2,603,792-byte CSV was retrieved and hashed. The file declares Llano Regional Hospital, the exact Llano campus, TX, 2026-03-01 and v3.0.0. The old Baylor Scott & White pointer remains historical and unrelated. This is an observed current file identity and metadata finding, not line-item validation or a legal compliance verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(path.join(audit, proofName), JSON.stringify(proof, null, 2) + '\n');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, official_domain: 'llanoregional.org', file_sha256: proof.full_file_sha256,
    full_file_bytes: proof.full_file_bytes }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
