'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const uhPriceUrl = 'https://www.uhhospitals.org/patients-and-visitors/billing-insurance-and-medical-records/cms-medicare-price-transparency-initiative';
const mercyPriceUrl = 'https://www.mercyhealthsystem.org/patientsvisitors/billing-information/chargemaster/';
const cases = [
  {
    ccn: '141335', rosterName: 'MERCY HARVARD HOSPITAL', rosterAddress: '901 S GRANT STREET',
    rosterCity: 'HARVARD', state: 'IL', zip: '60033',
    name: 'Mercyhealth Hospital & Medical Center - Harvard',
    address: '901 Grant Street, Harvard, IL 60033', date: '2026-03-01', kind: 'json',
    pointerUrl: 'https://mercyhealthsystem.org/cms-hpt.txt',
    fileUrl: 'https://res.cloudinary.com/dpmykpsih/raw/upload/fl_attachment/mercyhealth-site-398/media/2d1cbb17b353441aab7c37d9b22f6c99/311551871-mercyharvardhospital-standardchargers.json',
    pageFileUrl: 'https://www.mercyhealthsystem.org/media/2d1cbb17b353441aab7c37d9b22f6c99/311551871-mercyharvardhospital-standardchargers.json',
    facilityUrl: 'https://www.mercyhealthsystem.org/locations/mercyhealth-hospital-and-medical-center-harvard/',
    priceUrl: mercyPriceUrl, sourcePageUrl: mercyPriceUrl,
    facilityCheck: '901 Grant St',
  },
  {
    ccn: '360041', rosterName: 'PARMA COMMUNITY GENERAL HOSPITAL', rosterAddress: '7007 POWERS BOULEVARD',
    rosterCity: 'PARMA', state: 'OH', zip: '44129',
    name: 'University Hospitals Parma Medical Center', address: '7007 Powers Boulevard, Parma OH  44129',
    date: '2026-07-14', kind: 'csv', pointerUrl: 'https://uhhospitals.org/cms-hpt.txt',
    fileUrl: 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7897/340827442-1164481677_university-hospitals-health-system_standardcharges.csv',
    sourcePageUrl: 'https://search.hospitalpriceindex.com/hpi2/machineReadable/ParmaMedicalCenter/7897',
    facilityUrl: 'https://www.uhhospitals.org/locations/uh-parma-medical-center/about', priceUrl: uhPriceUrl,
    facilityCheck: 'Parma Community General Hospital',
  },
  {
    ccn: '360075', rosterName: 'UH REGIONAL HOSPITALS', rosterAddress: '13207 RAVENNA ROAD',
    rosterCity: 'CHARDON', state: 'OH', zip: '44024',
    name: 'University Hospitals Regional Hospitals - Geauga Medical Center',
    address: '13207 Ravenna Road, Chardon, OH 44024', date: '2026-07-14', kind: 'csv',
    pointerUrl: 'https://uhhospitals.org/cms-hpt.txt',
    fileUrl: 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7902/341924226-1669562864_university-hospitals-health-system_standardcharges.csv',
    sourcePageUrl: 'https://search.hospitalpriceindex.com/hpi2/machineReadable/GeaugaMedicalCenter/7902',
    facilityUrl: 'https://www.uhhospitals.org/locations/uh-geauga-medical-center/patients-and-visitors/getting-here',
    priceUrl: uhPriceUrl, facilityCheck: '13207 Ravenna Road',
  },
  {
    ccn: '361307', rosterName: 'UHHS MEMORIAL HOSPITAL OF GENEVA', rosterAddress: '870 WEST MAIN STREET',
    rosterCity: 'GENEVA', state: 'OH', zip: '44041',
    name: 'University Hospitals Geneva Medical Center',
    address: '870 West Main Street, Geneva, OH 44041', date: '2026-07-14', kind: 'csv',
    pointerUrl: 'https://uhhospitals.org/cms-hpt.txt',
    fileUrl: 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7899/340714461-1225128432_university-hospitals-health-system_standardcharges.csv',
    sourcePageUrl: 'https://search.hospitalpriceindex.com/hpi2/machineReadable/GenevaMedicalCenter/7899',
    facilityUrl: 'https://www.uhhospitals.org/locations/uh-geneva-medical-center/patients-visitors/',
    priceUrl: uhPriceUrl, facilityCheck: '870 West Main',
  },
];

async function capture(config, roster) {
  const [pointer, file, facility, price] = await Promise.all([
    retrieve(config.pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(config.fileUrl, 262144, { timeoutMs: 30000 }),
    retrieve(config.facilityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(config.priceUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const blocks = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/);
  const entry = blocks.find(block => block.toLowerCase().includes(`location-name: ${config.name.toLowerCase()}`));
  const safeEntry = entry?.split(/\r?\n/).filter(line => /^(location-name|source-page-url|mrf-url):/i.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream'))
    .parsed.find(item => item.innerKind === config.kind);
  const facilityText = cheerio.load(facility.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const priceHtml = price.body.toString('utf8');
  const locations = (parsed?.mrfLocationNames || parsed?.mrfLocationName || '').split('|');
  const addresses = (parsed?.mrfAddresses || parsed?.mrfAddress || '').split('|');
  const totalBytes = Number((file.headers['content-range'] || '').split('/')[1]) || null;
  if ([pointer, file, facility, price].some(result => ![200, 206].includes(result.status))
      || !safeEntry || safeEntry.length !== 3
      || safeEntry[0].replace(/\s+$/, '').toLowerCase() !== `location-name: ${config.name.toLowerCase()}`
      || safeEntry[1].toLowerCase() !== `source-page-url: ${config.sourcePageUrl.toLowerCase()}`
      || safeEntry[2].toLowerCase() !== `mrf-url: ${config.fileUrl.toLowerCase()}`
      || !facilityText.includes(config.facilityCheck)
      || !priceHtml.includes(config.pageFileUrl || config.fileUrl)
      || file.body.length !== 262144 || (totalBytes && totalBytes <= file.body.length)
      || !locations.includes(config.name) || !addresses.includes(config.address)
      || parsed.mrfLicenseState !== config.state || parsed.declaredLastUpdated !== config.date
      || parsed.cmsVersion !== '3.0.0'
      || (config.ccn === '141335' && parsed.mrfHospitalName !== config.name)
      || (config.ccn !== '141335' && parsed.mrfHospitalName !== 'University Hospitals Health System'))
    throw new Error(`${config.ccn} site, pointer, or campus-specific file metadata changed`);
  let pageFile = null;
  if (config.pageFileUrl) {
    pageFile = await retrieve(config.pageFileUrl, 262144, { timeoutMs: 30000 });
    if (![200, 206].includes(pageFile.status) || pageFile.sha256 !== file.sha256)
      throw new Error('Mercy Harvard pricing-page file no longer matches pointer file');
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn: config.ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    current_facility_name: config.name, first_party_facility_url: config.facilityUrl,
    first_party_facility_http_status: facility.status, first_party_facility_sha256: facility.sha256,
    first_party_pricing_url: config.priceUrl, first_party_pricing_http_status: price.status,
    first_party_pricing_sha256: price.sha256,
    first_party_page_file_url: config.pageFileUrl || config.fileUrl,
    first_party_page_file_sample_sha256: pageFile?.sha256 || file.sha256,
    pointer_url: config.pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_entry_without_contacts: safeEntry, pointer_location_name: config.name,
    file_url: config.fileUrl, file_http_status: file.status, file_total_bytes: totalBytes,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_names: locations, declared_addresses: addresses,
    matched_location_name: config.name, matched_address: config.address,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, file_kind: config.kind, observed_at: file.checkedAt,
    limitation: `The pointer file has multiple campus or unit entries; only the exact ${config.name} entry and its address were assigned to this CCN. Only the first 262,144 ${totalBytes ? `of ${totalBytes} ` : ''}file bytes were retained. Complete-file validity and legal compliance were not determined.`,
  };
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'exact-roster-campus-first-party-facility-and-pricing-page-distinct-pointer-entry-file-location-address',
    officialDomain: config.ccn === '141335' ? 'mercyhealthsystem.org' : 'uhhospitals.org',
    identityPageUrl: config.facilityUrl, sourcePageUrl: config.priceUrl,
    pointerUrl: config.pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: config.fileUrl, fileSha256: file.sha256, http_status: file.status,
    checked_at: file.checkedAt, date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: config.name, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: config.address, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: config.kind,
    next_action: `Validate the complete ${config.kind.toUpperCase()} and maintain campus/unit separation before any content or legal conclusion.`,
  };
  const note = `The roster identifies ${roster['Facility Name']} at ${roster.Address}, ${roster['City/Town']}. The current first-party facility and pricing pages identify the same ${config.name} campus and link its file. The live root pointer has a distinct ${config.name} entry; its bounded ${config.kind.toUpperCase()} bytes declare a matching named location and address, ${config.state}, ${config.date} and v3.0.0. Other named campuses or units in the pointer/file were not assigned to this CCN. This is a pointer/page/header observation, not complete-file validation or a legal verdict.`;
  return { proof, evidence, note };
}

async function main() {
  const rosters = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'));
  const bases = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const results = [];
  for (const config of cases) {
    const roster = rosters.find(row => row['Facility ID'] === config.ccn);
    const base = bases.find(row => row.ccn === config.ccn);
    if (!roster || roster['Facility Name'] !== config.rosterName || roster.Address !== config.rosterAddress
        || roster['City/Town'] !== config.rosterCity || roster.State !== config.state
        || roster['ZIP Code'] !== config.zip || !base
        || base.finding !== 'not-assessed-not-named-in-file' || base.pointer_url !== config.pointerUrl
        || ledger.some(row => row.ccn === config.ccn))
      throw new Error(`${config.ccn} roster, base, or prior resolution changed`);
    results.push({ config, base, ...(await capture(config, roster)) });
  }
  for (const { config, base, proof, evidence, note } of results) {
    fs.writeFileSync(path.join(audit, `reconciliation-multicampus-${config.ccn}-proof.json`), JSON.stringify(proof, null, 2) + '\n');
    ledger.push({ ccn: config.ccn, base, action: 'replace', evidence,
      evidence_run: `multicampus-exact-entry-${config.ccn}-2026-09-16`, reviewed_at: proof.observed_at, note });
  }
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify(results.map(({ proof }) => ({ ccn: proof.ccn, pointer_sha256: proof.pointer_sha256,
    sample_sha256: proof.sample_sha256, file_total_bytes: proof.file_total_bytes }))));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
