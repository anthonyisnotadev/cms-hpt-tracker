'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const pageUrl = 'https://www.wth.org/financial-assistance-billing/hospital-charges/';
const pointerUrl = 'https://www.wth.org/cms-hpt.txt';
const facilities = [
  { ccn: '440002', label: 'Jackson-Madison County General Hospital', name: 'Jackson-Madison County General Hospital',
    street: '620 Skyline', city: 'Jackson', date: '2026-06-05',
    identityUrl: 'https://www.wth.org/locations/jackson-madison-co-general/',
    fileUrl: 'https://www.wth.org/wp-content/uploads/standard-charges/62-6010402_JH_standard_Charges.csv' },
  { ccn: '441320', label: 'WTH Bolivar Hospital', name: 'West Tennessee Healthcare Bolivar Hospital',
    street: '650 Nuckolls', city: 'Bolivar', date: '2026-06-02',
    identityUrl: 'https://www.wth.org/locations/bolivar-hospital/',
    fileUrl: 'https://www.wth.org/wp-content/uploads/standard-charges/62-1624171_BH_Standard_Charges.csv' },
  { ccn: '441316', label: 'WTH Camden Hospital', name: 'West Tennessee Healthcare Camden Hospital',
    street: '175 Hospital', city: 'Camden', date: '2026-06-02',
    identityUrl: 'https://www.wth.org/locations/west-tennessee-healthcare-camden-hospital-emergency-room/',
    fileUrl: 'https://www.wth.org/wp-content/uploads/standard-charges/58-1884314_CH_Standard_Charges.csv' },
];

async function main() {
  const [page, pointer] = await Promise.all([
    retrieve(pageUrl, 1048576, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
  ]);
  const html = page.body.toString('utf8');
  if (page.status !== 200 || pointer.status !== 404 || !/404 Not Found/i.test(pointer.body.toString('utf8'))) {
    throw new Error('West Tennessee Healthcare page or root pointer changed');
  }
  for (const facility of facilities) {
    if (!html.includes(`${facility.label}: <a href="${facility.fileUrl}"`)) {
      throw new Error(`Current first-party page no longer labels the exact ${facility.ccn} file`);
    }
  }
  fs.mkdirSync(sampleDir, { recursive: true });
  const records = [];
  for (const facility of facilities) {
    const [identity, file] = await Promise.all([
      retrieve(facility.identityUrl, 1048576, { timeoutMs: 30000 }),
      retrieve(facility.fileUrl, 262144, { timeoutMs: 30000 }),
    ]);
    const identityText = identity.body.toString('utf8').toLowerCase();
    if (identity.status !== 200 || !identityText.includes(facility.name.toLowerCase())
        || !identityText.includes(facility.street.toLowerCase())
        || !identityText.includes(facility.city.toLowerCase())) {
      throw new Error(`Current first-party identity page changed for ${facility.ccn}`);
    }
    const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
    const header = parsed.parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
    if (file.status !== 206 || file.body.length !== 262144 || !header
        || header.mrfHospitalName !== facility.name || header.mrfLocationName !== facility.name
        || !header.mrfAddress.includes(facility.street) || !header.mrfAddress.includes(facility.city)
        || header.mrfLicenseState !== 'TN' || header.declaredLastUpdated !== facility.date
        || header.cmsVersion !== '3.0.0') throw new Error(`Current file proof incomplete for ${facility.ccn}`);
    const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
    fs.writeFileSync(samplePath, file.body);
    records.push({ ccn: facility.ccn, official_domain: 'wth.org',
      official_identity_url: facility.identityUrl, official_identity_sha256: identity.sha256,
      source_page_url: pageUrl, source_page_sha256: page.sha256,
      pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
      current_mrf_url: facility.fileUrl, current_mrf_http_status: file.status,
      current_mrf_sha256: file.sha256, retained_bytes: file.body.length,
      retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
      total_file_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
      declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
      declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
      declared_date: header.declaredLastUpdated, version: header.cmsVersion,
      observed_at: file.checkedAt,
      next_action: 'Retain this exact first-party page-linked file and metadata without calling it pointer-linked. Recheck the WTH root cms-hpt.txt after a publisher change; keep each hospital file assignment separate.' });
  }
  const artifact = { disposition: 'official-page-files-root-pointer-404', records };
  fs.writeFileSync(path.join(audit, 'reconciliation-wth-page-file-proofs.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify(records.map(({ ccn, current_mrf_sha256, declared_date }) =>
    ({ ccn, sample_sha256: current_mrf_sha256, date: declared_date }))));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
