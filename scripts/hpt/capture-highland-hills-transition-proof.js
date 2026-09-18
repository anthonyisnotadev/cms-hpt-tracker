'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { csvToObjects } = require('./lib/util');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '250172';
const pointerUrl = 'https://highlandhillsmc.com/cms-hpt.txt';
const identityUrl = 'https://highlandhillsmc.com/contact-highland-hills/';
const pricingUrl = 'https://highlandhillsmc.com/price-transparency/';
const transitionUrl = 'https://www.deltahealthsystem.org/news/2023/may/delta-health-system-announcement/';
const fileUrl = 'https://highlandhills.pg.quadax.revenuemasters.com/cdm-files/922135241_tate-county-hospital-dba-highland-hills-medical-center_standardcharges.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (!roster || roster['Facility Name'] !== 'HIGHLAND HILLS MEDICAL CENTER'
      || roster.Address !== '401 GETWELL DRIVE' || roster['City/Town'] !== 'SENATOBIA'
      || roster.State !== 'MS' || roster['ZIP Code'] !== '38668'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.domain !== 'deltahealthsystem.org')
    throw new Error('Highland Hills roster or original Delta assignment changed');
  const [pointer, identity, pricing, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const pricingText = pricing.body.toString('utf8');
  const header = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (![200, 206].includes(pointer.status) || !pointerText.includes('location-name: Highland Hills Medical Center')
      || !pointerText.includes(`mrf-url: ${fileUrl}`)
      || identity.status !== 200 || !identityText.includes('Highland Hills Medical Center')
      || !identityText.includes('401 Getwell Drive') || !identityText.includes('Senatobia')
      || !identityText.includes('38668')
      || pricing.status !== 200 || !pricingText.includes('Download MRF')
      || !pricingText.includes('922135241-5Ftate-2Dcounty-2Dhospital-2Ddba-2Dhighland-2Dhills-2Dmedical-2Dcenter-5Fstandardcharges.csv')
      || file.status !== 206 || file.body.length !== 262144
      || header?.mrfHospitalName !== 'tate county hospital | highland hills medical center'
      || header.mrfLocationName !== 'tate county hospital | highland hills medical center'
      || header.mrfAddress !== '401 Getwell Dr, Senatobia, MS 38668'
      || header.mrfLicenseState !== 'MS' || header.declaredLastUpdated !== '2026-03-27'
      || header.cmsVersion !== '3.0.0')
    throw new Error('Highland Hills current site, transition, pointer, or file evidence changed: ' + JSON.stringify({
      pointerStatus: pointer.status, pointerEntry: pointerText.includes('location-name: Highland Hills Medical Center'),
      pointerFile: pointerText.includes(`mrf-url: ${fileUrl}`),
      identityStatus: identity.status, identityName: identityText.includes('Highland Hills Medical Center'),
      identityAddress: identityText.includes('401 Getwell Drive'),
      pricingStatus: pricing.status, pricingDownload: pricingText.includes('Download MRF'),
      pricingFile: pricingText.includes('922135241_tate-county-hospital-dba-highland-hills-medical-center_standardcharges.csv'),
      fileStatus: file.status, fileBytes: file.body.length,
      header: header && { name: header.mrfHospitalName, location: header.mrfLocationName,
        address: header.mrfAddress, state: header.mrfLicenseState,
        date: header.declaredLastUpdated, version: header.cmsVersion },
    }));
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    former_assigned_domain: base.domain,
    current_official_domain: 'highlandhillsmc.com',
    identity_page_url: identityUrl, identity_page_sha256: identity.sha256,
    pricing_page_url: pricingUrl, pricing_page_sha256: pricing.sha256,
    transition_page_url: transitionUrl,
    transition_web_reader_observation: 'Delta Health System stated it completed the sale of Highland Hills to the Tate County Board of Supervisors on May 1, 2023.',
    transition_web_reader_observed_on: '2026-09-17',
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, pointer_location_name: 'Highland Hills Medical Center',
    mrf_url: fileUrl, mrf_http_status: file.status,
    mrf_sample_sha256: file.sha256, mrf_sample_bytes: file.body.length,
    mrf_total_bytes_from_content_range: Number((file.headers['content-range'] || '').split('/')[1]),
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress,
    declared_license_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Validate the complete exact CSV separately and recheck only after a publisher pointer or file change; the bounded header and campus identity do not establish complete-file or legal compliance.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-highland-hills-transition-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256,
    file_sha256: file.sha256, bytes: file.body.length }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
