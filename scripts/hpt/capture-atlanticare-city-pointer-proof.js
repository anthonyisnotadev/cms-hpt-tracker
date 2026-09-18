'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { csvToObjects } = require('./lib/util');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '310064';
const pointerUrl = 'https://atlanticare.org/cms-hpt.txt';
const campusUrl = 'https://www.atlanticare.org/locations/atlanticare-regional-medical-center-atlantic-city-campus';
const pricingUrl = 'https://www.atlanticare.org/patients-and-visitors/for-patients/billing-and-insurance/hospital-charge-list';
const fileUrl = 'https://atlanticare.pt.panaceainc.com/MRFDownload/atlanticare/atlanticare';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (!roster || roster['Facility Name'] !== 'ATLANTICARE REGIONAL MEDICAL CENTER - CITY CAMPUS'
      || roster.Address !== '1925 PACIFIC AVENUE' || roster['City/Town'] !== 'ATLANTIC CITY'
      || roster.State !== 'NJ' || roster['ZIP Code'] !== '08401'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.domain !== 'atlanticare.org' || base.pointer_url !== pointerUrl)
    throw new Error('AtlantiCare City roster or base assessment changed');
  const [pointer, campus, pricing, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(campusUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const entries = pointerText.split(/\r?\n\s*\r?\n/).map(block => Object.fromEntries(
    block.split(/\r?\n/).map(line => {
      const at = line.indexOf(': ');
      return at < 0 ? [] : [line.slice(0, at), line.slice(at + 2).trim()];
    }).filter(pair => pair.length === 2)));
  const city = entries.find(entry => entry['location-name'] === 'ARMC Atlantic City');
  const mainland = entries.find(entry => entry['location-name'] === 'ARMC Mainland');
  const campusText = cheerio.load(campus.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const $ = cheerio.load(pricing.body.toString('utf8'));
  const pricingLinks = $('a[href]').toArray().map(node => new URL($(node).attr('href'), pricingUrl).href);
  const header = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (![200, 206].includes(pointer.status) || pointer.body.length !== 617 || entries.length !== 2
      || city?.['mrf-url'] !== fileUrl || mainland?.['mrf-url'] !== fileUrl
      || city['source-page-url']?.replace(/\/$/, '') !== pricingUrl
      || ![200, 206].includes(campus.status) || !campusText.includes('1925 Pacific Avenue')
      || !campusText.includes('Atlantic City, NJ 08401')
      || ![200, 206].includes(pricing.status) || !pricingLinks.includes(fileUrl)
      || file.status !== 200 || file.body.length !== 262144
      || file.headers['content-length'] !== '1054023199'
      || header?.mrfHospitalName !== 'AtlantiCare Health System'
      || header.mrfLocationName !== 'ACRMC Mainland'
      || header.mrfAddress !== '65 West Jimmie Leeds Road, Pomona NJ 08240'
      || header.mrfLicenseState !== 'NJ' || header.declaredLastUpdated !== '2026-03-18'
      || header.cmsVersion !== '3.0.0')
    throw new Error('AtlantiCare City pointer/page/file role changed: ' + JSON.stringify({
      pointerStatus: pointer.status, pointerBytes: pointer.body.length,
      cityMrf: city?.['mrf-url'], mainlandMrf: mainland?.['mrf-url'],
      campusStatus: campus.status, pricingStatus: pricing.status, pageLinksFile: pricingLinks.includes(fileUrl),
      fileStatus: file.status, fileBytes: file.body.length,
      total: file.headers['content-length'], header,
    }));
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    campus_url: campusUrl, campus_sha256: campus.sha256,
    campus_address: '1925 Pacific Avenue, Atlantic City, NJ 08401',
    pricing_page_url: pricingUrl, pricing_page_sha256: pricing.sha256,
    pricing_page_links_file: true,
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, pointer_bytes: pointer.body.length,
    pointer_city_location_name: city['location-name'],
    pointer_mainland_location_name: mainland['location-name'],
    pointer_city_mrf_url: city['mrf-url'], pointer_mainland_mrf_url: mainland['mrf-url'],
    file_http_status: file.status, file_sample_sha256: file.sha256,
    file_sample_bytes: file.body.length, file_total_bytes: 1054023199,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_license_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Ask the publisher whether the City pointer entry should link a distinct Atlantic City file or whether the 1,054,023,199-byte shared CSV has City data elsewhere. Verify any City-specific header/location evidence from the exact file before assigning it to CCN 310064. The current bounded header identifies only Mainland; do not promote the City entry from the pointer label alone.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-atlanticare-city-pointer-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, sample_sha256: file.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
