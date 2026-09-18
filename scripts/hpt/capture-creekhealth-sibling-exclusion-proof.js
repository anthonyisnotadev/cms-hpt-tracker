'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://creekhealth.org/cms-hpt.txt';
const pricingUrl = 'https://www.creekhealth.org/price-transparency/';
const councilUrl = 'https://www.creekhealth.org/council-oak-comprehensive-healthcare/';
const okemahUrl = 'https://www.creekhealth.org/community-hospitals/creek-nation-community-hospital/';
const okmulgeeUrl = 'https://www.creekhealth.org/community-hospitals/okmulgee-medical-center/';
const fileUrl = 'https://apps.para-hcfs.com/PTT/FinalLinks/Reports.aspx?dbName=dbMCNMOKMULGEEOK&type=CDMWithoutLabel&fileType=CSV';
const xlsxUrl = 'http://www.creekhealth.org/wp-content/uploads/2026/05/731357965_Muscogee-Creek-Nation-Department-of-Health_standardcharges.xlsx';
const facilities = [
  { ccn: '370244', name: 'COUNCIL OAK COMPREHENSIVE HEALTHCARE', address: '10109 E 79TH ST',
    city: 'TULSA', state: 'OK', zip: '74133', page: councilUrl, pageAddress: '10109 E 79th St, Tulsa, OK 74133' },
  { ccn: '371333', name: 'CREEK NATION COMMUNITY HOSPITAL', address: '1800 E COPLIN',
    city: 'OKEMAH', state: 'OK', zip: '74859', page: okemahUrl, pageAddress: '1800 E Coplin Rd, Okemah, OK 74859' },
];

async function main() {
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'));
  const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8')).records;
  const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const proofFile = 'reconciliation-creekhealth-sibling-exclusion-proof.json';
  for (const facility of facilities) {
    const row = roster.find(item => item.ccn === facility.ccn);
    const current = verification.find(item => item.ccn === facility.ccn);
    if (!row || row.name !== facility.name || row.address !== facility.address
        || row.city !== facility.city || row.state !== facility.state || row.zip !== facility.zip
        || current?.disposition !== 'pointer-facility-match-unresolved'
        || current.pointer_corpus_checked_url !== pointerUrl
        || ledger.records.some(item => item.ccn === facility.ccn))
      throw new Error(`Creekhealth source or ledger changed for ${facility.ccn}`);
  }
  if (fs.existsSync(path.join(audit, proofFile))) throw new Error('Creekhealth proof already exists');

  const [pointer, pricing, council, okemah, okmulgee, file] = await Promise.all([
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(councilUrl, 262144, { timeoutMs: 30000 }),
    retrieve(okemahUrl, 262144, { timeoutMs: 30000 }),
    retrieve(okmulgeeUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const safePointerLines = pointer.body.toString('utf8').split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const pricingLinks = cheerio.load(pricing.body.toString('utf8'))('a[href]')
    .map((_, node) => new URL(node.attribs.href, pricingUrl).href).get();
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed
    .find(item => item.innerKind === 'csv');
  if (![200, 206].includes(pointer.status) || ![200, 206].includes(pricing.status)
      || ![200, 206].includes(council.status) || ![200, 206].includes(okemah.status)
      || ![200, 206].includes(okmulgee.status) || ![200, 206].includes(file.status)
      || file.body.length !== 262144
      || safePointerLines.length !== 3
      || !safePointerLines.includes('location-name: Muscogee Creek Nation Hospital & Clinics')
      || !safePointerLines.includes(`mrf-url: ${fileUrl}`)
      || !pricingLinks.includes(xlsxUrl)
      || !council.body.toString('utf8').includes(facilities[0].pageAddress)
      || !okemah.body.toString('utf8').includes(facilities[1].pageAddress)
      || !okmulgee.body.toString('utf8').includes('1401 Morris Dr, Okmulgee, OK 74447')
      || parsed?.mrfHospitalName !== 'MUSCOGEE (CREEK) NATION MEDICAL CENTER'
      || parsed.mrfLocationName !== 'MUSCOGEE (CREEK) NATION MEDICAL CENTER'
      || parsed.mrfAddress !== '1401 Morris Dr Okmulgee OK 74447'
      || parsed.mrfLicenseState !== 'OK' || parsed.declaredLastUpdated !== '2026-01-24'
      || parsed.cmsVersion !== '3.00')
    throw new Error(`Creekhealth evidence changed: ${JSON.stringify({ pointer: pointer.status,
      pricing: pricing.status, council: council.status, okemah: okemah.status,
      okmulgee: okmulgee.status, file: file.status, fileBytes: file.body.length,
      safePointerLines, hasXlsx: pricingLinks.includes(xlsxUrl), parsed })}`);

  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccns: facilities.map(item => item.ccn), observed_at: file.checkedAt,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_observed_at: pointer.checkedAt, pointer_entry_without_contacts: safePointerLines,
    pricing_page_url: pricingUrl, pricing_page_http_status: pricing.status,
    pricing_page_sha256: pricing.sha256, pricing_page_observed_at: pricing.checkedAt,
    pricing_page_file_lead_url: xlsxUrl,
    facility_pages: [
      { ccn: '370244', url: councilUrl, http_status: council.status, sha256: council.sha256,
        address: facilities[0].pageAddress },
      { ccn: '371333', url: okemahUrl, http_status: okemah.status, sha256: okemah.sha256,
        address: facilities[1].pageAddress },
      { role: 'pointer-file-campus', url: okmulgeeUrl, http_status: okmulgee.status,
        sha256: okmulgee.sha256, address: '1401 Morris Dr, Okmulgee, OK 74447' },
    ],
    pointer_file_url: fileUrl, pointer_file_http_status: file.status,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    retained_bytes: file.body.length, sample_sha256: file.sha256,
    file_declared_hospital_name: parsed.mrfHospitalName,
    file_declared_location_name: parsed.mrfLocationName,
    file_declared_address: parsed.mrfAddress,
    file_declared_license_state: parsed.mrfLicenseState,
    file_declared_date: parsed.declaredLastUpdated,
    file_declared_version: parsed.cmsVersion,
    conclusion: 'The exact shared root pointer has one Okmulgee-named entry and its byte-backed CSV header declares the Okmulgee campus. Separate first-party facility pages place Council Oak in Tulsa and Creek Nation Community Hospital in Okemah. Neither CCN inherits the Okmulgee file. The pricing-page XLSX is a separate lead, not an adjudicated CSV/JSON MRF for either CCN.',
  };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  for (const facility of facilities) ledger.records.push({
    ccn: facility.ccn, observed_at: file.checkedAt, proof_file: proofFile,
    official_facility_page: facility.page, official_facility_address: facility.pageAddress,
    pointer_url: pointerUrl, pointer_file_url: fileUrl, pointer_file_sample_sha256: file.sha256,
    pointer_file_declared_address: parsed.mrfAddress, pricing_page_xlsx_lead_url: xlsxUrl,
    disposition: 'shared-root-pointer-file-belongs-to-okmulgee-sibling',
    next_action: `Find or obtain a first-party root-pointer entry and CSV/JSON MRF for ${facility.name} at ${facility.pageAddress}; do not assign the Okmulgee file or infer that the page-linked XLSX resolves this exact CCN. Then verify file identity, address, state, date, and version.`,
  });
  ledger.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccns: proof.ccns, pointer_sha256: pointer.sha256,
    sample_sha256: file.sha256, pricing_page_sha256: pricing.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
