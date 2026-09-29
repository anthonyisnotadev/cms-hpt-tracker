'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://ochsner.org/cms-hpt.txt';
const facilities = [
  {
    ccn: '250069', name: 'OCHSNER RUSH HOSPITAL', rosterAddress: '1314 19TH AVE',
    city: 'MERIDIAN', zip: '39301', pointerName: 'Ochsner Rush Medical Center',
    identityUrl: 'https://www.ochsner.org/locations/ochsner-rush-medical-center/',
    identityStreet: '1314 19th Ave', fileAddress: '1314 19th Avenue, Meridian, MS 39301',
    hospitalName: 'Rush Medical Foundation', locationName: 'Ochsner Rush Medical Center',
    fileUrl: 'https://ochsner-craft.s3.amazonaws.com/core/640345119_rush-medical-foundation_standardcharges.csv_2026-03-26-190726_skmh.csv',
  },
  {
    ccn: '250162', name: 'OCHSNER MEDICAL CENTER-HANCOCK', rosterAddress: '149 DRINKWATER BLVD',
    city: 'BAY SAINT LOUIS', zip: '39520', pointerName: 'Ochsner Medical Center - Hancock',
    identityUrl: 'https://www.ochsner.org/locations/ochsner-medical-center-hancock/',
    identityStreet: '149 Drinkwater Blvd', fileAddress: '149 Drinkwater Road, Bay St. Louis, MS 39520-1658',
    hospitalName: 'OCHSNER MEDICAL CENTER – HANCOCK LLC',
    locationName: 'OCHSNER MEDICAL CENTER – HANCOCK',
    fileUrl: 'https://ochsner-craft.s3.amazonaws.com/core/822869576_ochsner-medical-center-%E2%80%93-hancock-llc_standardcharges.csv_2026-03-26-181953_akak.csv',
  },
];

async function main() {
  const pointer = await retrieve(pointerUrl, 65536, { timeoutMs: 30000 });
  const pointerText = pointer.body.toString('utf8');
  if (![200, 206].includes(pointer.status) || pointer.body.length < 9000)
    throw new Error('Ochsner root pointer not currently readable');
  const records = [];
  for (const facility of facilities) {
    const [identity, file] = await Promise.all([
      retrieve(facility.identityUrl, 262144, { timeoutMs: 30000 }),
      retrieve(facility.fileUrl, 262144, { timeoutMs: 30000 }),
    ]);
    const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
    const header = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv'))
      .parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
    if (!pointerText.includes(`location-name: ${facility.pointerName}`)
        || !pointerText.includes(`mrf-url: ${facility.fileUrl}`)
        || identity.status !== 200 || !identityText.includes(facility.pointerName)
        || !identityText.includes(facility.identityStreet)
        || !identityText.includes(facility.zip)
        || file.status !== 206 || file.body.length !== 262144
        || header?.mrfHospitalName !== facility.hospitalName
        || header.mrfLocationName !== facility.locationName
        || header.mrfAddress !== facility.fileAddress
        || header.mrfLicenseState !== 'LA'
        || header.declaredLastUpdated !== '2026-04-01'
        || header.cmsVersion !== '3.0.0')
      throw new Error(`Ochsner proof changed for ${facility.ccn}`);
    const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
    fs.mkdirSync(sampleDir, { recursive: true });
    const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
    fs.writeFileSync(samplePath, file.body);
    records.push({
      ccn: facility.ccn, roster_name: facility.name, roster_address: facility.rosterAddress,
      roster_city: facility.city, roster_state: 'MS', roster_zip: facility.zip,
      official_domain: 'ochsner.org', identity_page_url: facility.identityUrl,
      identity_page_sha256: identity.sha256,
      pointer_url: pointerUrl, pointer_final_url: pointer.finalUrl,
      pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
      pointer_location_name: facility.pointerName, mrf_url: facility.fileUrl,
      mrf_http_status: file.status, mrf_sample_sha256: file.sha256,
      mrf_sample_bytes: file.body.length,
      mrf_total_bytes_from_content_range: Number((file.headers['content-range'] || '').split('/')[1]),
      retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
      declared_hospital_name: header.mrfHospitalName,
      declared_location_name: header.mrfLocationName,
      declared_address: header.mrfAddress,
      declared_license_state: header.mrfLicenseState,
      declared_date: header.declaredLastUpdated, version: header.cmsVersion,
      hancock_address_suffix_caveat: facility.ccn === '250162'
        ? 'Official page and roster say Blvd; bounded file header says Road at the same 149 Drinkwater, Bay St. Louis, MS 39520 campus.' : '',
      observed_at: file.checkedAt,
      next_action: 'Ask the publisher to clarify or correct the LA license-state field for this Mississippi hospital; for Hancock also reconcile Road versus Blvd in the file address. Validate the complete exact CSV separately before making any full-file or legal conclusion.',
    });
  }
  fs.writeFileSync(path.join(audit, 'reconciliation-ochsner-mississippi-state-proofs.json'),
    JSON.stringify({ records }, null, 2) + '\n');
  console.log(JSON.stringify(records.map(row => ({ ccn: row.ccn, pointer_sha256: row.pointer_sha256,
    file_sha256: row.mrf_sample_sha256, declared_license_state: row.declared_license_state }))));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
