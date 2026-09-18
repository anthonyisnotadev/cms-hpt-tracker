'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://www.midlandhealth.org/cms-hpt.txt';
const pageUrl = 'https://www.midlandhealth.org/main/price-transparency';
const identityUrl = 'https://www.midlandhealth.org/main/locations/midland-memorial-hospital-1';
const oldUrl = 'https://www.midlandhealth.org/Uploads/Public/Documents/Price%20Transparency/751584559_midland-health_standardcharges.csv';
const currentUrl = 'https://www.midlandhealth.org/Uploads/Public/Documents/Price%20Transparency/751584559_midland-health_standardcharges%20(9).csv';

async function main() {
  const [pointer, page, identity, oldFile, currentFile] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(oldUrl, 65536, { timeoutMs: 30000, curlOnStatuses: [403, 404] }),
    retrieve(currentUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const $ = cheerio.load(page.body.toString('utf8'));
  const links = $('a[href]').map((_, a) => {
    try { return new URL($(a).attr('href'), pageUrl).href; } catch { return ''; }
  }).get();
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const header = (await parsePayload(currentFile.body,
    currentFile.headers['content-type'] || 'text/csv')).parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (pointer.status !== 200 || page.status !== 200 || identity.status !== 200
      || oldFile.status !== 404 || currentFile.status !== 206 || currentFile.body.length !== 262144
      || links.filter(link => link === currentUrl).length !== 1
      || !pointerText.includes('location-name: Midland Memorial Hospital')
      || !pointerText.includes(`mrf-url: ${oldUrl.replaceAll('%20', ' ')}`)
      || !identityText.includes('Midland Memorial Hospital')
      || !identityText.includes('400 Rosalind Redfern Grover Parkway')
      || !identityText.includes('Midland, TX 79701')
      || header?.mrfHospitalName !== 'Midland County Hospital District'
      || !header.mrfLocationName.includes('Midland County Hospital District')
      || !header.mrfAddress.includes('400 Rosalind Redfern Grover Parkway, Midland, TX 79701')
      || header.mrfLicenseState !== 'TX' || header.declaredLastUpdated !== '2026-04-01'
      || header.cmsVersion !== '3.0.0') throw new Error('Midland proof changed or is incomplete');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${currentFile.sha256}.bin`);
  fs.writeFileSync(samplePath, currentFile.body);
  const proof = {
    ccn: '450133', official_domain: 'midlandhealth.org',
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_location_name: 'Midland Memorial Hospital',
    pointer_mrf_url: oldUrl.replaceAll('%20', ' '), pointer_mrf_request_url: oldUrl,
    pointer_mrf_http_status: oldFile.status, source_page_url: pageUrl,
    source_page_sha256: page.sha256, identity_url: identityUrl, identity_sha256: identity.sha256,
    current_mrf_url: currentUrl, current_mrf_http_status: currentFile.status,
    current_mrf_sha256: currentFile.sha256, retained_bytes: currentFile.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: currentFile.checkedAt,
    next_action: 'Recheck the exact Midland Memorial root-pointer CSV target after a publisher update; preserve the separately page-linked district CSV and audit its complete structure and campus coverage independently.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-midland-pointer-page-proof.json'),
    JSON.stringify({ disposition: 'pointer-target-404-current-page-csv', records: [proof] }, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: proof.ccn, old_status: oldFile.status,
    current_status: currentFile.status, sample_sha256: currentFile.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
