'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const facilityUrl = 'https://www.uhhospitals.org/locations/uh-tripoint-medical-center/patients-visitors';
const cmsIdentityUrl = 'https://www.cms.gov/medicare/medicare-general-information/medicareapprovedfacilitie/carotid-artery-stenting-facilities-items/lake-hospital-system-inc';
const pricingUrl = 'https://www.uhhospitals.org/patients-and-visitors/billing-insurance-and-medical-records/cms-medicare-price-transparency-initiative';
const pointerUrl = 'https://lakehealth.org/cms-hpt.txt';
const fileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/11435/341425870-1972689172_university-hospitals-health-system_standardcharges.csv';
const sourcePageUrl = 'https://search.hospitalpriceindex.com/hpi2/machineReadable/LakeWestMedicalCenter/11435';
const locationName = 'University Hospitals Tripoint Medical Center';
const address = '7590 Auburn Road, Painesville OH  44077';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '360098');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '360098');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (!roster || roster['Facility Name'] !== 'LAKE HEALTH'
      || roster.Address !== '7590 AUBURN ROAD' || roster['City/Town'] !== 'CONCORD'
      || roster.State !== 'OH' || roster['ZIP Code'] !== '44077'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.pointer_url !== pointerUrl || ledger.some(row => row.ccn === '360098'))
    throw new Error('Lake Health roster, base, or previous resolution changed');
  const [facility, cms, pricing, pointer, file] = await Promise.all([
    retrieve(facilityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(cmsIdentityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const facilityText = cheerio.load(facility.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const cmsText = cheerio.load(cms.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const pricingHtml = pricing.body.toString('utf8');
  const pointerEntries = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .filter(block => block.toLowerCase().includes(`mrf-url: ${fileUrl.toLowerCase()}`));
  const tripoint = pointerEntries.find(block => block.toLowerCase().includes(`location-name: ${locationName.toLowerCase()}`));
  const safeEntry = tripoint?.split(/\r?\n/).filter(line => /^(location-name|source-page-url|mrf-url):/i.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream'))
    .parsed.find(item => item.innerKind === 'csv');
  const locations = (parsed?.mrfLocationNames || parsed?.mrfLocationName || '').split('|');
  const addresses = (parsed?.mrfAddresses || parsed?.mrfAddress || '').split('|');
  const totalBytes = Number((file.headers['content-range'] || '').split('/')[1]) || null;
  if ([facility, cms, pricing, pointer, file].some(result => ![200, 206].includes(result.status))
      || !facilityText.includes('UH TriPoint Medical Center')
      || !facilityText.includes('7590 Auburn Rd.') || !facilityText.includes('Concord Township')
      || !cmsText.includes('360098') || !cmsText.includes('7590 Auburn Road')
      || !cmsText.includes('36000 Euclid Avenue')
      || !pricingHtml.includes(fileUrl) || !pricingHtml.includes('UH Lake West Medical Center')
      || !pricingHtml.includes('UH TriPoint Medical Center')
      || pointerEntries.length !== 2 || !safeEntry || safeEntry.length !== 3
      || safeEntry[0].toLowerCase() !== `location-name: ${locationName.toLowerCase()}`
      || safeEntry[1].toLowerCase() !== `source-page-url: ${sourcePageUrl.toLowerCase()}`
      || safeEntry[2].toLowerCase() !== `mrf-url: ${fileUrl.toLowerCase()}`
      || file.body.length !== 262144 || !totalBytes || totalBytes <= file.body.length
      || !locations.includes(locationName) || !addresses.includes(address)
      || parsed.mrfHospitalName !== 'University Hospitals Health System'
      || parsed.mrfLicenseState !== 'OH' || parsed.declaredLastUpdated !== '2026-07-14'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Lake Health TriPoint site, CMS identity, pointer, or shared file changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn: '360098', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    current_facility_name: 'UH TriPoint Medical Center', first_party_facility_url: facilityUrl,
    first_party_facility_http_status: facility.status, first_party_facility_sha256: facility.sha256,
    cms_ccn_identity_url: cmsIdentityUrl, cms_ccn_identity_http_status: cms.status,
    cms_ccn_identity_sha256: cms.sha256,
    cms_additional_address: '36000 Euclid Avenue, Willoughby, OH 44094',
    first_party_pricing_url: pricingUrl, first_party_pricing_http_status: pricing.status,
    first_party_pricing_sha256: pricing.sha256,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_entry_without_contacts: safeEntry, shared_pointer_entry_count: pointerEntries.length,
    file_url: fileUrl, file_http_status: file.status, file_total_bytes: totalBytes,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_names: locations, declared_addresses: addresses,
    matched_location_name: locationName, matched_address: address,
    city_wording_difference: 'Roster and current UH facility page say Concord/Concord Township; the shared CSV lists Painesville for the same 7590 Auburn Road, OH 44077 campus.',
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, file_kind: 'csv', observed_at: file.checkedAt,
    limitation: `The file and pointer are shared with Lake West and other units. TriPoint at 7590 Auburn Road is the roster-matched location; the CMS record also lists Lake West's Willoughby address for this CCN. The Painesville/Concord locality difference remains documented. Only 262,144 of ${totalBytes} CSV bytes were retained. Complete-file validity and legal compliance were not determined.`,
  };
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'cms-ccn-exact-auburn-address-first-party-tripoint-campus-shared-pointer-file-location-address',
    officialDomain: 'uhhospitals.org', identityPageUrl: facilityUrl, sourcePageUrl: pricingUrl,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status,
    checked_at: file.checkedAt, date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: locationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: address, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'csv',
    next_action: 'Validate the complete shared Lake West/TriPoint CSV and clarify the Painesville versus Concord locality field; retain separate location-level attribution.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-lake-health-shared-campus-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn: '360098', base, action: 'replace', evidence,
    evidence_run: 'lake-health-tripoint-shared-campus-2026-09-16', reviewed_at: file.checkedAt,
    note: 'The roster calls CCN 360098 Lake Health at 7590 Auburn Road, Concord. An official CMS record joins that CCN to the Auburn Road campus and also lists Lake West at 36000 Euclid Avenue; the current UH page identifies TriPoint at the Auburn Road site. UH pricing and root pointer deliberately share one file between TriPoint and Lake West. Bounded file bytes declare a distinct TriPoint location at 7590 Auburn Road, OH 44077, dated 2026-07-14 with v3.0.0. TriPoint is the roster-matched location, while Lake West remains an additional CMS-listed address for this CCN. The file says Painesville while the roster and UH page say Concord/Concord Township; this difference remains explicit. Complete-file validity and legal compliance were not determined.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '360098', pointer_sha256: pointer.sha256,
    sample_sha256: file.sha256, total_bytes: totalBytes }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
