'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://www.camc.org/cms-hpt.txt';
const pointerMrfUrl = 'https://app.box.com/shared/static/aidlfax3cyzn902r713m3ofochu48bev.csv';
const sourcePageUrl = 'https://www.camc.org/patients-and-visitors/billing-insurance-and-financial-assistance/price-transparency';
const currentMrfUrl = 'https://app.box.com/shared/static/jcuhk9tqybb7r0ls9p81r10w0xaqhfr3.csv';
const identityUrl = 'https://www.camc.org/locations/camc-greenbrier-valley-medical-center';

async function main() {
  const [pointer, pointerFile, page, currentFile, identity] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pointerMrfUrl, 65536, { timeoutMs: 30000 }),
    retrieve(sourcePageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(currentMrfUrl, 262144, { timeoutMs: 30000 }),
    retrieve(identityUrl, 131072, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const $ = cheerio.load(page.body.toString('utf8'));
  const pageText = $('body').text().replace(/\s+/g, ' ');
  const links = $('a').map((_, a) => new URL($(a).attr('href') || '', sourcePageUrl).href)
    .get().filter(url => url === currentMrfUrl);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const header = (await parsePayload(currentFile.body, currentFile.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (![200, 206].includes(pointer.status)
      || !String(pointer.headers['content-type']).startsWith('text/plain')
      || !pointerText.includes('location-name: Greenbrier Valley Medical Center')
      || !pointerText.includes(`mrf-url: ${pointerMrfUrl}`)
      || pointerFile.status !== 404 || ![200, 206].includes(page.status)
      || !pageText.includes('CAMC Greenbrier Valley Medical Center Price Transparency')
      || links.length !== 1 || ![200, 206].includes(currentFile.status)
      || currentFile.body.length !== 262144
      || ![200, 206].includes(identity.status)
      || !identityText.includes('CAMC Greenbrier Valley Medical Center')
      || !identityText.includes('1320 Maplewood Ave')
      || !header || header.mrfHospitalName !== 'Greenbrier Valley Medical Center'
      || header.mrfAddress !== '1320 Maplewood Ave , Ronceverte, WV 24970'
      || header.mrfLicenseState !== 'WV' || header.declaredLastUpdated !== '2026-07-15'
      || header.cmsVersion !== '3.0.0') {
    throw new Error('Current CAMC Greenbrier pointer/page/file proof changed');
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${currentFile.sha256}.bin`);
  fs.writeFileSync(samplePath, currentFile.body);
  const record = {
    ccn: '510002', official_domain: 'camc.org', pointer_url: pointerUrl,
    pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_mrf_url: pointerMrfUrl, pointer_mrf_http_status: pointerFile.status,
    pointer_mrf_sha256: pointerFile.sha256,
    source_page_url: sourcePageUrl, source_page_sha256: page.sha256,
    official_identity_url: identityUrl, official_identity_sha256: identity.sha256,
    current_mrf_url: currentMrfUrl, current_mrf_http_status: currentFile.status,
    current_mrf_sha256: currentFile.sha256, retained_bytes: currentFile.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: currentFile.checkedAt,
    next_action: 'Recheck the exact pointer-declared Box URL after publisher change; retain the separately page-linked Greenbrier Valley CSV without calling it pointer-linked or inferring compliance.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-camc-greenbrier-pointer-mismatch-proof.json'),
    `${JSON.stringify({ disposition: 'pointer-target-404-current-page-file', record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, pointerTarget: record.pointer_mrf_http_status,
    currentFile: record.current_mrf_http_status, sha256: record.current_mrf_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
