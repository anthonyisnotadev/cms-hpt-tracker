'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const pageUrl = 'https://www.nmhs.net/Patients-and-Visitors/Pricing/Price-Transparency';
const pointerUrl = 'https://nmhs.net/cms-hpt.txt';
const dbaUrl = 'https://www.nmhs.net/locations/belmont-family-medical-clinic';
const facilities = [
  { ccn: '250004', pointerName: 'North Mississippi Medical Center, Inc.',
    pageLabel: 'North Mississippi Medical Center, Inc. Standard Charges',
    fileName: 'North Mississippi Medical Center', street: '830 S Gloster Street', city: 'Tupelo',
    identityUrl: 'https://www.nmhs.net/locations/north-mississippi-medical-center-tupelo',
    identityName: 'North Mississippi Medical Center-Tupelo', identityStreet: '830 South Gloster',
    pointerFileUrl: 'https://apps.nmhs.net/files/pt_mrf/640662976_north-mississippi-medical-center-inc_standardcharges.json',
    pageFileUrl: 'https://apps.nmhs.net/files/pt_mrf/640662976_north-mississippi-medical-center_standardcharges.json' },
  { ccn: '250002', pointerName: 'Tishomingo Health Services, Inc.',
    pageLabel: 'Tishomingo Health Services, Inc. Standard Charges',
    fileName: 'TISHOMINGO HEALTH SERVICES,INC', street: '1777 Curtis Drive', city: 'Iuka',
    identityUrl: 'https://www.nmhs.net/locations/north-mississippi-medical-center-iuka',
    identityName: 'North Mississippi Medical Center-Iuka', identityStreet: '1777 Curtis Drive',
    pointerFileUrl: 'https://apps.nmhs.net/files/pt_mrf/640741047_tishomingo-health-services-inc_standardcharges.json',
    pageFileUrl: 'https://apps.nmhs.net/files/pt_mrf/640741047_tishomingo-health-services,inc-_standardcharges.json' },
];

async function main() {
  const [pointer, page, dba] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(dbaUrl, 262144, { timeoutMs: 30000 }),
  ]);
  if (pointer.status !== 206 || page.status !== 200 || dba.status !== 200
      || !dba.body.toString('utf8').includes('Tishomingo Health Services DBA North Mississippi Medical Center-Iuka')) {
    throw new Error('NMHS current pointer, pricing page or first-party DBA evidence changed');
  }
  const pointerSections = pointer.body.toString('utf8').split(/(?=location-name:)/i);
  const $ = cheerio.load(page.body.toString('utf8'));
  for (const facility of facilities) {
    const section = pointerSections.find(text => text.includes(`location-name: ${facility.pointerName}`));
    const hrefs = $('a').filter((_, a) => $(a).text().trim() === facility.pageLabel)
      .map((_, a) => $(a).attr('href')).get();
    if (!section || !section.includes(`mrf-url: ${facility.pointerFileUrl}`)
        || hrefs.length !== 1 || hrefs[0] !== facility.pageFileUrl) {
      throw new Error(`NMHS exact pointer/page link assignment changed for ${facility.ccn}`);
    }
  }
  fs.mkdirSync(sampleDir, { recursive: true });
  const records = [];
  for (const facility of facilities) {
    const [identity, pointerFile, pageFile] = await Promise.all([
      retrieve(facility.identityUrl, 524288, { timeoutMs: 30000 }),
      retrieve(facility.pointerFileUrl, 65536, { timeoutMs: 30000 }),
      retrieve(facility.pageFileUrl, 262144, { timeoutMs: 30000 }),
    ]);
    const identityText = identity.body.toString('utf8').toLowerCase();
    if (identity.status !== 200 || !identityText.includes(facility.identityName.toLowerCase())
        || !identityText.includes(facility.identityStreet.toLowerCase())) {
      throw new Error(`NMHS facility identity page changed for ${facility.ccn}`);
    }
    if (pointerFile.status !== 404) throw new Error(`NMHS exact pointer target result changed for ${facility.ccn}`);
    const parsed = await parsePayload(pageFile.body, pageFile.headers['content-type'] || '');
    const header = parsed.parsed.find(item => item.innerKind === 'json' && item.mrfHospitalName);
    if (pageFile.status !== 206 || pageFile.body.length !== 262144 || !header
        || header.mrfHospitalName.trim().toLowerCase() !== facility.fileName.toLowerCase()
        || !header.mrfAddress.includes(facility.street) || !header.mrfAddress.includes(facility.city)
        || header.mrfLicenseState !== 'MS' || header.declaredLastUpdated !== '2026-04-01'
        || header.cmsVersion !== '3.0.0') throw new Error(`NMHS current page-file metadata incomplete for ${facility.ccn}`);
    const samplePath = path.join(sampleDir, `${pageFile.sha256}.bin`);
    fs.writeFileSync(samplePath, pageFile.body);
    records.push({ ccn: facility.ccn, official_domain: 'nmhs.net',
      official_identity_url: facility.identityUrl, official_identity_sha256: identity.sha256,
      corporate_mapping_url: facility.ccn === '250002' ? dbaUrl : '',
      corporate_mapping_sha256: facility.ccn === '250002' ? dba.sha256 : '',
      source_page_url: pageUrl, source_page_sha256: page.sha256,
      pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
      pointer_mrf_url: facility.pointerFileUrl, pointer_mrf_http_status: pointerFile.status,
      pointer_mrf_sha256: pointerFile.sha256,
      current_mrf_url: facility.pageFileUrl, current_mrf_http_status: pageFile.status,
      current_mrf_sha256: pageFile.sha256, retained_bytes: pageFile.body.length,
      retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
      declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
      declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
      declared_date: header.declaredLastUpdated, version: header.cmsVersion,
      observed_at: pageFile.checkedAt,
      next_action: 'Retain the first-party page-linked JSON and its identity/metadata. Recheck the exact stale pointer-declared URL after a publisher change; do not call the current page file pointer-linked or infer a compliance verdict.' });
  }
  fs.writeFileSync(path.join(audit, 'reconciliation-nmhs-pointer-mismatch-proofs.json'),
    `${JSON.stringify({ disposition: 'pointer-target-404-current-page-file', records }, null, 2)}\n`);
  console.log(JSON.stringify(records.map(row => ({ ccn: row.ccn, pointer_target: row.pointer_mrf_http_status,
    current_file: row.current_mrf_http_status, sample_sha256: row.current_mrf_sha256 }))));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
