'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '371319';
const pointerUrl = 'https://ccghospital.com/cms-hpt.txt';
const pageUrl = 'https://www.ccghospital.com/price-transparency';
const sheetUrl = 'https://docs.google.com/spreadsheets/d/18Ffdx4imEdGgzYSDmUI4oE6bgsg5oMs5vUllJijd1MQ/edit?usp=sharing';
const fileUrl = 'https://www.ccghospital.com/_files/ugd/ce403d_f7d290420a6b4d73b459c987ea568cb9.csv?dn=731235996_coal-county-general-hospital_standardcharges.csv.csv';

async function main() {
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .find(row => row.ccn === ccn);
  const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'))
    .records.find(row => row.ccn === ccn);
  const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const proofFile = 'reconciliation-coal-county-page-file-proof.json';
  if (roster?.name !== 'COAL COUNTY GENERAL HOSPITAL, INC.'
      || roster.address !== '6 NORTH COVINGTON' || roster.city !== 'COALGATE'
      || roster.state !== 'OK' || roster.zip !== '74538'
      || nationwide?.disposition !== 'pointer-facility-match-unresolved'
      || ledger.records.some(row => row.ccn === ccn)
      || fs.existsSync(path.join(audit, proofFile)))
    throw new Error('Coal County roster, assessment, or reviewed ledger changed');

  const [pointer, page, file] = await Promise.all([
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const safePointerLines = pointer.body.toString('utf8').split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const $ = cheerio.load(page.body.toString('utf8'));
  const pageLinks = $('a[href]').map((_, node) => new URL($(node).attr('href'), pageUrl).href).get();
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed
    .find(item => item.innerKind === 'csv');
  if (![200, 206].includes(pointer.status) || ![200, 206].includes(page.status)
      || file.status !== 206 || file.body.length !== 262144
      || !safePointerLines.includes('location-name: Coal County General Hospital')
      || !safePointerLines.includes(`mrf-url: ${sheetUrl}`)
      || !pageLinks.includes(fileUrl)
      || parsed?.mrfHospitalName !== 'Coal County General Hospital'
      || parsed.mrfLocationName !== 'Coal County General Hospital'
      || parsed.mrfAddress !== '6 North Covington Street, Coalgate, OK, 74538'
      || parsed.mrfLicenseState !== 'OK' || parsed.declaredLastUpdated !== '2026-03-30'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error(`Coal County evidence changed: ${JSON.stringify({ pointer: pointer.status,
      page: page.status, file: file.status, fileBytes: file.body.length, safePointerLines,
      hasFileLink: pageLinks.includes(fileUrl), parsed })}`);

  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster.name, roster_address: roster.address, roster_city: roster.city,
    roster_state: roster.state, roster_zip: roster.zip,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_observed_at: pointer.checkedAt, pointer_entry_without_contacts: safePointerLines,
    pointer_target_url: sheetUrl, pointer_target_role: 'Google Sheets edit HTML page, not the page-linked CSV',
    first_party_pricing_page_url: pageUrl, pricing_page_http_status: page.status,
    pricing_page_sha256: page.sha256, pricing_page_observed_at: page.checkedAt,
    pricing_page_file_url: fileUrl, file_http_status: file.status,
    file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    retained_bytes: file.body.length, sample_sha256: file.sha256,
    file_declared_hospital_name: parsed.mrfHospitalName,
    file_declared_location_name: parsed.mrfLocationName,
    file_declared_address: parsed.mrfAddress,
    file_declared_license_state: parsed.mrfLicenseState,
    file_declared_date: parsed.declaredLastUpdated,
    file_declared_version: parsed.cmsVersion,
    observed_at: file.checkedAt,
    limitation: 'The root pointer names a Google Sheets edit page, while the current first-party page separately links a CSV. Only the first 262144 CSV bytes were retained. File identity and declared metadata agree with the roster, but pointer-to-CSV linkage and complete-file validity remain unverified. No legal compliance verdict.',
  };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  ledger.records.push({ ccn, observed_at: file.checkedAt, proof_file: proofFile,
    official_pricing_page: pageUrl, pointer_url: pointerUrl,
    pointer_target_url: sheetUrl, pointer_target_role: 'Google Sheets edit HTML page',
    page_file_url: fileUrl, page_file_sample_sha256: file.sha256,
    file_declared_address: parsed.mrfAddress, file_declared_license_state: parsed.mrfLicenseState,
    file_declared_date: parsed.declaredLastUpdated, file_declared_version: parsed.cmsVersion,
    disposition: 'first-party-page-file-identity-corroborated-pointer-target-google-sheet',
    next_action: 'Resolve the root pointer to a direct CSV/JSON MRF target or document an official export chain to the current page-linked CSV. Then validate the complete exact file before promoting a pointer-linked current MRF claim. Keep the Google Sheets edit target and page-linked CSV as separate source roles.' });
  ledger.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, page_sha256: page.sha256,
    sample_sha256: file.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
