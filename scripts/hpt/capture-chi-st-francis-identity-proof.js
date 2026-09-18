'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const oldPointerUrl = 'https://allinahealth.org/cms-hpt.txt';
const pointerUrl = 'https://www.chistfrancishealth.org/cms-hpt.txt';
const pageUrl = 'https://www.chistfrancishealth.org/patient-visitor-information/financial-payments/price-transparency/standard-charges';
const identityUrl = 'https://www.chistfrancishealth.org/patient-visitor-information';
const fileUrl = 'https://www.chistfrancishealth.org/content/dam/sfcareorg/website/workfiles/410695598-1639162381_st-francis-medical-center_standardcharges.csv';
const wrongFileUrl = 'https://www.allinahealth.org/-/media/allina-health/files/customer-service/billing-and-insurance/price-transparency/363261413_st-francis-regional-medical-center_standardcharges.csv';

async function main() {
  const [oldPointer, pointer, page, identity, file] = await Promise.all([
    retrieve(oldPointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 131072, { timeoutMs: 30000 }),
    retrieve(identityUrl, 131072, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const oldText = oldPointer.body.toString('utf8');
  const pointerText = pointer.body.toString('utf8');
  const $ = cheerio.load(page.body.toString('utf8'));
  const links = $('a').map((_, a) => new URL($(a).attr('href') || '', pageUrl).href).get()
    .filter(url => url === fileUrl);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const header = (await parsePayload(file.body, file.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (![200, 206].includes(oldPointer.status)
      || !oldText.includes('location-name: St. Francis Regional Medical Center')
      || !oldText.includes(`mrf-url: ${wrongFileUrl}`)
      || ![200, 206].includes(pointer.status)
      || !String(pointer.headers['content-type']).startsWith('text/plain')
      || !pointerText.includes('location-name:CHI St. Francis Health')
      || !pointerText.includes(`mrf-url: ${fileUrl}`)
      || ![200, 206].includes(page.status) || links.length !== 1
      || ![200, 206].includes(identity.status)
      || !identityText.includes('2400 St. Francis Drive Breckenridge, MN 56520')
      || file.status !== 200 || file.body.length !== 262144
      || !header || header.mrfHospitalName !== 'ST. FRANCIS MEDICAL CENTER'
      || header.mrfLocationName !== 'CHI St. Francis Health'
      || header.mrfAddress !== '2400 ST. FRANCIS DR, Breckenridge, MN 56520'
      || header.mrfLicenseState !== 'MN' || header.declaredLastUpdated !== '2026-02-28'
      || header.cmsVersion !== '3.0.0') {
    throw new Error('Current CHI St. Francis identity proof changed');
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '241377', official_domain: 'chistfrancishealth.org',
    rejected_domain: 'allinahealth.org',
    rejected_pointer_url: oldPointerUrl,
    rejected_pointer_sha256: oldPointer.sha256,
    rejected_pointer_location_name: 'St. Francis Regional Medical Center',
    rejected_mrf_url: wrongFileUrl,
    rejected_facility_city: 'Shakopee',
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, pointer_location_name: 'CHI St. Francis Health',
    source_page_url: pageUrl, source_page_sha256: page.sha256,
    official_identity_url: identityUrl, official_identity_sha256: identity.sha256,
    mrf_url: fileUrl, mrf_http_status: file.status, mrf_sha256: file.sha256,
    retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Monitor the CHI St. Francis root pointer and direct file for changes; retain Allina St. Francis Regional Medical Center as a rejected different-facility assignment. Bounded header proof is not full-file validation.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-chi-st-francis-identity-proof.json'),
    `${JSON.stringify({ disposition: 'wrong-same-name-facility-corrected-with-direct-pointer-file', record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, rejected: record.rejected_pointer_location_name,
    current: record.pointer_location_name, file: record.mrf_http_status,
    sha256: record.mrf_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
