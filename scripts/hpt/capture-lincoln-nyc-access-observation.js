'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '330080';
const identityUrl = 'https://www.nychealthandhospitals.org/locations/lincoln/';
const pricingUrl = 'https://www.nychealthandhospitals.org/paying-for-your-health-care/facility-charges/';
const pointerUrl = 'https://nychealthandhospitals.org/cms-hpt.txt';
const fileUrl = 'https://nychh.pt.panaceainc.com/MRFDownload/nychh/lincoln-medical';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'LINCOLN MEDICAL & MENTAL HEALTH CENTER'
      || roster.Address !== '234 EAST 149TH STREET' || roster['City/Town'] !== 'BRONX'
      || roster.State !== 'NY' || roster['ZIP Code'] !== '10451'
      || base?.finding !== 'not-assessed-not-named-in-file' || base.pointer_url !== pointerUrl)
    throw new Error('Lincoln roster or previous assessment changed');
  const [identity, pricing, pointer, file] = await Promise.all([
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes('location-name: Lincoln Medical Center'));
  const safeEntry = entry?.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream'))
    .parsed.find(item => item.innerKind === 'csv');
  const challenged = result => result.status === 200
    && /<title>Radware Captcha Page<\/title>/i.test(result.body.toString('utf8'));
  if (!challenged(identity) || !challenged(pricing)
      || ![200, 206].includes(pointer.status) || ![200, 206].includes(file.status)
      || !safeEntry?.includes('location-name: Lincoln Medical Center')
      || !safeEntry.includes(`source-page-url: ${pricingUrl}`)
      || !safeEntry.includes(`mrf-url: ${fileUrl}`)
      || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'New York City Health and Hospitals Corporation'
      || parsed.mrfLocationName !== 'Lincoln Medical Center'
      || parsed.mrfAddress !== '234 E 149th St, Bronx, NY 10451'
      || parsed.mrfLicenseState !== 'NY' || parsed.declaredLastUpdated !== '2026-09-05'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Lincoln challenge, pointer, or bounded file evidence changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    first_party_identity_url: identityUrl, identity_bounded_client_status: identity.status,
    identity_bounded_client_response: 'Radware Captcha Page', identity_response_sha256: identity.sha256,
    first_party_pricing_url: pricingUrl, pricing_bounded_client_status: pricing.status,
    pricing_bounded_client_response: 'Radware Captcha Page', pricing_response_sha256: pricing.sha256,
    web_reader_identity_observation: 'The official facility page rendered NYC Health + Hospitals/Lincoln at 234 East 149th Street, Bronx NY 10451 in the web reader.',
    web_reader_pricing_observation: 'The official facility-charges page listed 132655001_Lincoln-Medical-Center_standardcharges.csv and linked the pointer-declared vendor endpoint in the web reader.',
    browser_observation: 'In-app browser ended at ERR_CONNECTION_CLOSED; Brave navigation timed out. Neither proved a page or file failure.',
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_entry_without_contacts: safeEntry, file_url: fileUrl,
    file_http_status: file.status, file_final_host: new URL(file.finalUrl).hostname,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, observed_at: file.checkedAt,
    limitation: 'First-party site pages were not captured as content-bearing bytes by the bounded client or app browsers. Keep the CCN unresolved pending a verifiable official-page route; do not count the challenge as a hospital-file failure. Only 262,144 MRF bytes were retained.',
  };
  const proofName = 'reconciliation-lincoln-nyc-access-proof.json';
  const observationPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const observations = JSON.parse(fs.readFileSync(observationPath, 'utf8'));
  if (observations.records.some(row => row.ccn === ccn)) throw new Error('Existing Lincoln access observation requires manual review');
  fs.writeFileSync(path.join(audit, proofName), JSON.stringify(proof, null, 2) + '\n');
  observations.records.push({
    ccn, observed_at: file.checkedAt, proof_file: proofName,
    official_facility_page: identityUrl, official_pricing_page: pricingUrl,
    bounded_page_result: 'both first-party page requests redirected to HTTP 200 Radware CAPTCHA HTML',
    browser_result: 'in-app ERR_CONNECTION_CLOSED; Brave navigation timeout',
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_location_name: 'Lincoln Medical Center', pointer_file_url: fileUrl,
    pointer_file_http_status: file.status, pointer_file_sample_sha256: file.sha256,
    declared_file_location: parsed.mrfLocationName, declared_file_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion,
    disposition: 'pointer-and-mrf-header-identify-exact-campus-first-party-pages-challenged-to-client',
    next_action: 'Capture the official Lincoln facility and charges pages through an authorized content-bearing route, or obtain an independent current publisher page record. Keep the CCN unresolved until the page-to-file relationship is verifiably recorded; do not infer a file failure from the Radware page challenge.',
  });
  observations.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(observationPath, JSON.stringify(observations, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, sample_sha256: file.sha256,
    disposition: 'page-challenged-pointer-file-readable' }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
