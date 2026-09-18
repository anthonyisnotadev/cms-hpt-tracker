'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://lincolnhealthsystem.com/cms-hpt.txt';
const pointerFileUrl = 'https://hhlincolnhealth.org/wp-content/uploads/882472117_hh-health-system-lincoln-inc_standardcharges.csv';
const pageUrl = 'https://lincolnhealthsystem.com/patients-visitors/price-transparency/';
const pageFileUrl = 'https://lincolnhealthsystem.com/wp-content/uploads/882472117_hh-health-system-lincoln-inc_standardcharges.csv';

async function main() {
  const [pointer, pointerFile, page, pageFile] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pointerFileUrl, 65536, { timeoutMs: 15000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pageFileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const $ = cheerio.load(page.body.toString('utf8'));
  const pageText = $('body').text().replace(/\s+/g, ' ').toLowerCase();
  const links = $('a').map((_, a) => new URL($(a).attr('href') || '', pageUrl).href).get()
    .filter(url => url === pageFileUrl);
  const header = (await parsePayload(pageFile.body, pageFile.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (pointer.status !== 206 || !String(pointer.headers['content-type']).startsWith('text/plain')
      || pointerFile.status !== 0 || !/Resolving timed out/i.test(pointerFile.error || '')
      || page.status !== 200 || pageFile.status !== 206 || pageFile.body.length !== 262144
      || !pointerText.includes('location-name: Lincoln Medical Center')
      || !pointerText.includes(`mrf-url: ${pointerFileUrl}`)
      || !pointerText.includes('source-page-url: https://hhlincolnhealth.org/patients-visitors/price-transparency/')
      || links.length !== 1 || !pageText.includes('106 medical center')
      || !pageText.includes('fayetteville') || !header
      || header.mrfHospitalName !== 'HH Health System Lincoln Inc'
      || header.mrfLocationName !== 'Lincoln Medical Center'
      || header.mrfAddress !== '106 Medical Center Blvd, Fayetteville, TN, 37334'
      || header.mrfLicenseState !== 'TN' || header.declaredLastUpdated !== '2026-07-31'
      || header.cmsVersion !== '3.0.0') throw new Error('Lincoln pointer/DNS/page/file evidence changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${pageFile.sha256}.bin`);
  fs.writeFileSync(samplePath, pageFile.body);
  const record = {
    ccn: '440102', official_domain: 'lincolnhealthsystem.com',
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_source_page_url: 'https://hhlincolnhealth.org/patients-visitors/price-transparency/',
    pointer_mrf_url: pointerFileUrl, pointer_mrf_http_status: pointerFile.status,
    pointer_mrf_transport_error: (pointerFile.error || '').trim(),
    pointer_mrf_checked_at: pointerFile.checkedAt,
    browser_target_url: pointerFileUrl, browser_error_code: 'ERR_NAME_NOT_RESOLVED',
    browser_observed_on: '2026-09-16',
    browser_observation_method: 'Codex in-app browser direct navigation displayed a host-name-resolution error',
    source_page_url: pageUrl, source_page_sha256: page.sha256,
    current_mrf_url: pageFileUrl, current_mrf_http_status: pageFile.status,
    current_mrf_sha256: pageFile.sha256, retained_bytes: pageFile.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName, declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState, declared_date: header.declaredLastUpdated,
    version: header.cmsVersion, observed_at: pageFile.checkedAt,
    next_action: 'Retain the current first-party page-linked CSV and metadata. Recheck the pointer-declared hhlincolnhealth.org host only after DNS changes or through a demonstrably different network; seek a publisher update to the current lincolnhealthsystem.com file URL. Do not infer file absence or compliance from client DNS failures.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-lincoln-pointer-dns-proof.json'),
    `${JSON.stringify({ disposition: 'pointer-host-dns-client-failure-current-page-file', record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, pointer_target_status: record.pointer_mrf_http_status,
    browser_error: record.browser_error_code, page_file_sha256: record.current_mrf_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
