'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pageUrl = 'https://www.bridgeporthospital.org/patients-visitors/billing-insurance/Pricing';
const pointerUrl = 'https://bridgeporthospital.org/cms-hpt.txt';
const oldFileUrl = 'https://www.bridgeporthospital.org/-/media/Files/YNHHS/sc/06-0646554-Bridgeport-Hospital_standard_charges-1.ashx';
const currentFileUrl = 'https://www.bridgeporthospital.org/-/media/Files/YNHHS/sc/06-0646554-Bridgeport-Hospital_standard_charges-2.ashx';

async function main() {
  const [pointer, page, oldFile, currentFile] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(oldFileUrl, 65536, { timeoutMs: 30000, curlOnStatuses: [403, 404] }),
    retrieve(currentFileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const pageText = page.body.toString('utf8');
  const $ = cheerio.load(pageText);
  const matchingLinks = $('a[href]').map((_, a) => {
    try { return new URL($(a).attr('href'), pageUrl).href; } catch { return ''; }
  }).get().filter(url => url === currentFileUrl);
  const header = (await parsePayload(currentFile.body, currentFile.headers['content-type'] || 'text/csv')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (![200, 206].includes(pointer.status) || page.status !== 200 || oldFile.status !== 404
      || currentFile.status !== 206 || currentFile.body.length !== 262144
      || !pointerText.includes('location-name: Bridgeport Hospital')
      || !pointerText.includes(`mrf-url: ${oldFileUrl}`)
      || matchingLinks.length !== 1 || !pageText.includes('267 Grant Street')
      || header?.mrfHospitalName !== 'Bridgeport Hospital'
      || !header.mrfLocationName.includes('Bridgeport_ Hospital')
      || !header.mrfAddress.includes('267 Grant Street, Bridgeport CT, 06610')
      || header.mrfLicenseState !== 'CT' || header.declaredLastUpdated !== '2026-01-01'
      || header.cmsVersion !== '3.0.0') throw new Error('Bridgeport pointer/page/file proof changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${currentFile.sha256}.bin`);
  fs.writeFileSync(samplePath, currentFile.body);
  const proof = {
    ccn: '070010', official_domain: 'bridgeporthospital.org', source_page_url: pageUrl,
    source_page_sha256: page.sha256, pointer_url: pointerUrl,
    pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_mrf_url: oldFileUrl, pointer_mrf_http_status: oldFile.status,
    pointer_mrf_final_url: oldFile.finalUrl || '',
    current_mrf_url: currentFileUrl, current_mrf_http_status: currentFile.status,
    current_mrf_sha256: currentFile.sha256, retained_bytes: currentFile.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: currentFile.checkedAt,
    next_action: 'After the publisher updates the Bridgeport root pointer, verify that it names the current first-party page-linked CSV. Separately audit the complete file; do not treat the page file as pointer-linked yet.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-bridgeport-pointer-mismatch-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: proof.ccn, pointer_target_status: proof.pointer_mrf_http_status,
    current_file_status: proof.current_mrf_http_status, sample_sha256: proof.current_mrf_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
