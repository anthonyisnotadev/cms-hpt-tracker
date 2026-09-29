'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://www.bournewood.com/cms-hpt.txt';
const pageUrl = 'https://www.bournewood.com/resources/price-transparency-payments/';
const identityUrl = 'https://www.bournewood.com/contact-us/';
const staleUrl = 'https://www.bournewood.com/wp-content/uploads/2025/09/PRICE_TRANSPARENCY.csv';
const currentUrl = 'https://www.bournewood.com/wp-content/uploads/2025/09/V3.0.0_Tall_CSV_Format_Bournewood-Hospital-Price-Transp.csv';

async function main() {
  const [pointer, page, identity, stale, current] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 524288, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(staleUrl, 65536, { timeoutMs: 30000, curlOnStatuses: [403, 404] }),
    retrieve(currentUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const $ = cheerio.load(page.body.toString('utf8'));
  const links = $('a[href]').map((_, a) => {
    try { return new URL($(a).attr('href'), pageUrl).href; } catch { return ''; }
  }).get();
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const header = (await parsePayload(current.body, current.headers['content-type'] || 'text/csv')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (pointer.status !== 200 || page.status !== 200 || identity.status !== 200
      || stale.status !== 404 || current.status !== 200 || current.body.length !== 20266
      || links.filter(link => link === currentUrl).length !== 1
      || !pointerText.includes('location-name: Bournewood Health Systems')
      || !pointerText.includes(`mrf-url: ${staleUrl}`)
      || !identityText.includes('Bournewood') || !identityText.includes('300 South St.')
      || !identityText.includes('Brookline, MA 02467')
      || header?.mrfHospitalName.trim() !== 'Bournewood Hospital'
      || header.mrfLocationName.trim() !== 'Bournewood Hospital'
      || header.mrfAddress !== '300 SOUTH STREET  BROOKLINE  MA 02467'
      || header.mrfLicenseState !== null || header.declaredLastUpdated !== '2026-08-31'
      || header.cmsVersion !== '3.0.0') throw new Error('Bournewood proof changed or is incomplete');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${current.sha256}.bin`);
  fs.writeFileSync(samplePath, current.body);
  const proof = {
    ccn: '224022', official_domain: 'bournewood.com',
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_location_name: 'Bournewood Health Systems',
    pointer_mrf_url: staleUrl, pointer_mrf_http_status: stale.status,
    source_page_url: pageUrl, source_page_sha256: page.sha256,
    identity_url: identityUrl, identity_sha256: identity.sha256,
    current_mrf_url: currentUrl, current_mrf_http_status: current.status,
    current_mrf_sha256: current.sha256, retained_bytes: current.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName.trim(),
    declared_location_name: header.mrfLocationName.trim(), declared_address: header.mrfAddress,
    declared_license_state: null, declared_date: header.declaredLastUpdated,
    version: header.cmsVersion, observed_at: current.checkedAt,
    next_action: 'Recheck the exact Bournewood root-pointer CSV target after a publisher update. Separately inspect the page-linked complete CSV structure and the absent standalone license-state field; do not treat that page file as pointer-linked.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-bournewood-pointer-page-proof.json'),
    JSON.stringify({ disposition: 'pointer-target-404-current-page-csv', records: [proof] }, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: proof.ccn, stale_status: stale.status, current_status: current.status,
    file_sha256: current.sha256, complete_bytes: current.body.length }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
