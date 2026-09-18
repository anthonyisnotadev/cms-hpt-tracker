'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '521351';
const pointerUrl = 'https://ramchealth.com/cms-hpt.txt';
const pageUrl = 'https://ramchealth.com/billing-finances/about-your-bill/';
const pointerFileUrl = 'https://ramchealth.com/price-transparency/1144487372_Reedsburg-Area-Medical-Center_standardcharges_0.csv';
const pageFileUrl = 'https://ramchealth.com/price-transparency/1144487372_reedsburg-area-medical-center_standardcharges_0.csv';

async function main() {
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .find(row => row.ccn === ccn);
  const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'))
    .records.find(row => row.ccn === ccn);
  const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const proofFile = 'reconciliation-reedsburg-pointer-case-proof.json';
  if (roster?.name !== 'REEDSBURG AREA MEDICAL CENTER'
      || roster.address !== '2000 N DEWEY AVE' || roster.city !== 'REEDSBURG'
      || roster.state !== 'WI' || roster.zip !== '53959'
      || nationwide?.disposition !== 'pointer-facility-match-unresolved'
      || ledger.records.some(row => row.ccn === ccn)
      || fs.existsSync(path.join(audit, proofFile)))
    throw new Error('Reedsburg roster, assessment, or reviewed ledger changed');

  const [pointer, page, pointerFile, pageFile] = await Promise.all([
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerFileUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pageFileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const safePointerLines = pointer.body.toString('utf8').split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const $ = cheerio.load(page.body.toString('utf8'));
  const pageLinks = $('a[href]').map((_, node) => new URL($(node).attr('href'), pageUrl).href).get();
  const parsed = (await parsePayload(pageFile.body, pageFile.headers['content-type'] || 'text/csv')).parsed
    .find(item => item.innerKind === 'csv');
  if (![200, 206].includes(pointer.status) || ![200, 206].includes(page.status)
      || pointerFile.status !== 404 || pageFile.status !== 206 || pageFile.body.length !== 262144
      || !safePointerLines.includes('location-name: Reedsburg Area Medical Center')
      || !safePointerLines.includes(`mrf-url: ${pointerFileUrl}`)
      || !pageLinks.includes(pageFileUrl)
      || parsed?.mrfHospitalName !== 'Reedsburg Area Medical Center'
      || parsed.mrfLocationName !== 'Reedsburg Area Medical Center'
      || parsed.mrfAddress !== '2000 N Dewey Ave, Reedsburg, WI 53959'
      || parsed.mrfLicenseState !== 'WI' || parsed.declaredLastUpdated !== '2026-02-20'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error(`Reedsburg evidence changed: ${JSON.stringify({ pointer: pointer.status,
      page: page.status, pointerFile: pointerFile.status, pageFile: pageFile.status,
      pageFileBytes: pageFile.body.length, safePointerLines,
      hasPageFileLink: pageLinks.includes(pageFileUrl), parsed })}`);

  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${pageFile.sha256}.bin`);
  fs.writeFileSync(samplePath, pageFile.body);
  const proof = {
    ccn, roster_name: roster.name, roster_address: roster.address, roster_city: roster.city,
    roster_state: roster.state, roster_zip: roster.zip,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_observed_at: pointer.checkedAt, pointer_entry_without_contacts: safePointerLines,
    first_party_pricing_page_url: pageUrl, pricing_page_http_status: page.status,
    pricing_page_sha256: page.sha256, pricing_page_observed_at: page.checkedAt,
    pointer_file_url: pointerFileUrl, pointer_file_http_status: pointerFile.status,
    pointer_file_observed_at: pointerFile.checkedAt,
    page_file_url: pageFileUrl, page_file_http_status: pageFile.status,
    page_file_total_bytes: Number((pageFile.headers['content-range'] || '').split('/')[1]) || null,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    retained_bytes: pageFile.body.length, sample_sha256: pageFile.sha256,
    file_declared_hospital_name: parsed.mrfHospitalName,
    file_declared_location_name: parsed.mrfLocationName,
    file_declared_address: parsed.mrfAddress,
    file_declared_license_state: parsed.mrfLicenseState,
    file_declared_date: parsed.declaredLastUpdated,
    file_declared_version: parsed.cmsVersion,
    observed_at: pageFile.checkedAt,
    limitation: 'The exact pointer-declared URL returned HTTP 404 to this bounded client. The current first-party page links a case-different CSV that returned 262144 bytes with identity-matched metadata. No redirect/equivalence between the URLs was observed; the complete 32.75 MB file and rate content were not validated. No legal compliance verdict.',
  };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  ledger.records.push({ ccn, observed_at: pageFile.checkedAt, proof_file: proofFile,
    official_pricing_page: pageUrl, pointer_url: pointerUrl,
    pointer_mrf_url: pointerFileUrl, pointer_mrf_bounded_status: pointerFile.status,
    page_file_url: pageFileUrl, page_file_sample_sha256: pageFile.sha256,
    file_declared_address: parsed.mrfAddress, file_declared_license_state: parsed.mrfLicenseState,
    file_declared_date: parsed.declaredLastUpdated, file_declared_version: parsed.cmsVersion,
    disposition: 'pointer-file-client-404-page-file-identity-corroborated-case-different',
    next_action: 'Resolve the exact root-pointer URL to the current page-linked CSV or document a publisher-approved case-sensitive correction. Then validate the complete page file and rate-level content before any pointer-linked MRF claim; do not treat this client 404 as a legal verdict.' });
  ledger.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, page_sha256: page.sha256,
    sample_sha256: pageFile.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
