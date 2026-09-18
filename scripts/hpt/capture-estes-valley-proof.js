'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://www.uchealth.org/cms-hpt.txt';
const pageUrl = 'https://www.uchealth.org/billing-and-pricing/shoppable-services-and-all-services-price-lists/';
const identityUrl = 'https://www.uchealth.org/locations/uchealth-estes-valley-medical-center/';
const fileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8187/393395823_uchealth-estes-valley-medical-center_standardcharges.csv';

async function main() {
  const pointer = await retrieve(pointerUrl, 65536, { timeoutMs: 30000 });
  const page = await retrieve(pageUrl, 262144, { timeoutMs: 30000 });
  const identity = await retrieve(identityUrl, 262144, { timeoutMs: 30000 });
  const file = await retrieve(fileUrl, 262144, { timeoutMs: 30000 });
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes('location-name: UCHealth Estes Valley Medical Center'));
  const $ = cheerio.load(page.body.toString('utf8'));
  const namedLinks = $('a[href]').filter((_, a) => $(a).text().trim() === 'Estes Valley Medical Center')
    .map((_, a) => new URL($(a).attr('href'), pageUrl).href).get();
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const header = (await parsePayload(file.body, 'text/csv')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (pointer.status !== 200 || !entry || !entry.includes(`mrf-url: ${fileUrl}`)
      || page.status !== 200 || !namedLinks.includes(fileUrl)
      || identity.status !== 200 || !identityText.includes('UCHealth Estes Valley Medical Center')
      || !identityText.includes('555 Prospect Avenue') || !identityText.includes('Estes Park, CO 80517')
      || file.status !== 206 || file.body.length !== 262144
      || !header || header.mrfHospitalName !== 'UCHealth Estes Valley Medical Center'
      || !header.mrfLocationName.split('|').every(name => name.trim() === 'UCHealth Estes Valley Medical Center')
      || !header.mrfAddress.split('|').every(address => address === '555 Prospect Avenue, Estes Park, CO 80517')
      || header.mrfLicenseState !== 'CO' || header.declaredLastUpdated !== '2025-11-01'
      || header.cmsVersion !== '3.0.0') {
    throw new Error('Current Estes Valley pointer/page/file proof changed');
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '061312', official_domain: 'uchealth.org',
    previous_vendor_domain: 'search.hospitalpriceindex.com',
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, pointer_location_name: 'UCHealth Estes Valley Medical Center',
    official_pricing_page_url: pageUrl, official_pricing_page_http_status: page.status,
    official_pricing_page_sha256: page.sha256,
    official_identity_url: identityUrl, official_identity_http_status: identity.status,
    official_identity_sha256: identity.sha256,
    mrf_url: fileUrl, mrf_http_status: file.status,
    mrf_sample_sha256: file.sha256, retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated,
    version: header.cmsVersion,
    observed_at: new Date().toISOString(),
    next_action: 'Monitor the exact UCHealth pointer and file after publisher changes and run a separate full-file structural audit; this observation verifies the pointer and bounded header only.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-estes-valley-proof.json'),
    `${JSON.stringify({ record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, pointer: pointer.status,
    file: file.status, sample_sha256: file.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
