'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://davishealthsystem.org/cms-hpt.txt';
const pointerFileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8555/550375433_davis-memorial-hospital_standardcharges.csv';
const pageUrl = 'https://www.davishealthsystem.org/patients-visitors/price-transparency';
const identityUrl = 'https://www.davishealthsystem.org/contact-us/locations/davis-medical-center';
const fileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8555/550375433_davis-medical-center_standardcharges.csv';

async function main() {
  const [pointer, pointerFile, page, identity, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pointerFileUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 131072, { timeoutMs: 30000 }),
    retrieve(identityUrl, 131072, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const $ = cheerio.load(page.body.toString('utf8'));
  const links = $('a').map((_, a) => new URL($(a).attr('href') || '', pageUrl).href).get()
    .filter(url => url === fileUrl);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const header = (await parsePayload(file.body, file.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (![200, 206].includes(pointer.status)
      || !String(pointer.headers['content-type']).startsWith('text/plain')
      || !pointerText.includes('location-name: Davis Medical Center')
      || !pointerText.includes(`mrf-url: ${pointerFileUrl}`)
      || pointerFile.status !== 404 || page.status !== 200 || links.length !== 1
      || ![200, 206].includes(identity.status)
      || !identityText.includes('Davis Medical Center')
      || !identityText.includes('812 Gorman Avenue')
      || !identityText.includes('Elkins')
      || file.status !== 206 || file.body.length !== 262144
      || !header || header.mrfHospitalName !== 'Davis Medical Center'
      || header.mrfLocationName !== 'Davis Medical Center|Davis Medical Center|Davis Medical Center|Davis Medical Center'
      || !header.mrfAddress.startsWith('812 Gorman Ave, Elkins, WV 26241|')
      || header.mrfLicenseState !== 'WV' || header.declaredLastUpdated !== '2026-07-30'
      || header.cmsVersion !== '3.0.0') {
    throw new Error('Current Davis Medical pointer/page/file proof changed');
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '510030', official_domain: 'davishealthsystem.org',
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, pointer_mrf_url: pointerFileUrl,
    pointer_mrf_http_status: pointerFile.status, pointer_mrf_sha256: pointerFile.sha256,
    source_page_url: pageUrl, source_page_sha256: page.sha256,
    official_identity_url: identityUrl, official_identity_sha256: identity.sha256,
    current_mrf_url: fileUrl, current_mrf_http_status: file.status,
    current_mrf_sha256: file.sha256, retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Recheck the exact pointer-declared Davis Memorial URL after publisher change; retain the current first-party page-linked multi-location Davis Medical Center CSV, with 812 Gorman Avenue corroborated for this CCN, without treating it as pointer-linked or compliant.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-davis-medical-pointer-mismatch-proof.json'),
    `${JSON.stringify({ disposition: 'pointer-target-404-current-page-file', record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, pointerTarget: record.pointer_mrf_http_status,
    currentFile: record.current_mrf_http_status, sha256: record.current_mrf_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
