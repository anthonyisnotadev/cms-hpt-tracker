'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://ozarkhealth.net/cms-hpt.txt';
const pageUrl = 'https://ozarkhealth.net/price-transparency';
const locationUrl = 'https://www.ozarkhealth.net/location/ozark-health';
const fileUrl = 'https://ozarkhealth.net/sites/default/files/pdf/710407683_ozark-health-inc_standardcharges.csv';

async function main() {
  const [pointer, page, location, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(locationUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const pageText = page.body.toString('utf8');
  const locationText = cheerio.load(location.body.toString('utf8'))('body').text()
    .replace(/\s+/g, ' ').toLowerCase();
  const $ = cheerio.load(pageText);
  const links = $('a').map((_, a) => new URL($(a).attr('href') || '', pageUrl).href)
    .get().filter(url => url === fileUrl);
  const header = (await parsePayload(file.body, file.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfLocationName);
  if (pointer.status !== 200 || !String(pointer.headers['content-type']).includes('text/html')
      || !pointerText.toLowerCase().includes('<!doctype html>')
      || page.status !== 200 || location.status !== 200
      || file.status !== 206 || file.body.length !== 262144
      || !pointerText.includes('location-name: Ozark Health Inc')
      || !pointerText.includes(`mrf-url: ${fileUrl}`) || links.length !== 1
      || !locationText.includes('ozark health') || !locationText.includes('2500 hwy. 65 s.')
      || !locationText.includes('clinton, ar 72031') || !header
      || header.mrfHospitalName !== 'Ozark Health Inc.' || header.mrfLocationName !== 'Ozark Health'
      || header.mrfAddress !== '2500 Highway 65 South, Clinton, AR, 72031-6588'
      || header.mrfLicenseState !== 'AR' || header.declaredLastUpdated !== '2026-04-01'
      || header.cmsVersion !== '3.0.0') throw new Error('Ozark current pointer, page, location or file changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '041313', official_domain: 'ozarkhealth.net', pointer_url: pointerUrl,
    pointer_http_status: pointer.status, pointer_content_type: pointer.headers['content-type'],
    pointer_sha256: pointer.sha256,
    source_page_url: pageUrl, source_page_sha256: page.sha256,
    official_location_url: locationUrl, official_location_sha256: location.sha256,
    current_mrf_url: fileUrl, current_mrf_http_status: file.status,
    current_mrf_sha256: file.sha256, retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-ozark-pointer-file-proof.json'),
    `${JSON.stringify({ disposition: 'html-root-path-current-page-file', record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, pointer_status: record.pointer_http_status,
    file_status: record.current_mrf_http_status, sample_sha256: record.current_mrf_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
