'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://oaklawnhospital.org/cms-hpt.txt';
const pageUrl = 'https://oaklawnhospital.org/tools-resources/price-transparency/';
const identityUrl = 'https://providers.oaklawnhospital.org/location/oaklawn-hospital/loc0000229651';
const staleUrl = 'https://oaklawnhospital.org/381368347_ella-em-brown-charitable-circle-dba-oaklawn-hospital_standardcharges.csv.zip';
const currentUrl = 'https://oaklawnhospital.org/oaklawn-standard-charges.csv.zip';

async function main() {
  const [pointer, page, identity, stale, current] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
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
  const parsed = (await parsePayload(current.body, current.headers['content-type'] || 'application/zip')).parsed;
  const header = parsed.find(item => item.innerKind === 'csv' && item.member === 'oaklawn-standard-charges.csv');
  if (![200, 206].includes(pointer.status) || ![200, 206].includes(page.status)
      || identity.status !== 200 || stale.status !== 404 || current.status !== 206
      || current.body.length !== 262144 || links.filter(link => link === currentUrl).length !== 1
      || !pointerText.includes('location-name: Oaklawn Hospital')
      || !pointerText.includes(`mrf-url: ${staleUrl}`)
      || !identityText.includes('Oaklawn Hospital')
      || !identityText.includes('200 North Madison Street')
      || !identityText.includes('Marshall, MI 49068')
      || header?.mrfHospitalName !== 'Ella E.M. Brown Charitable Circle dba Oaklawn Hospital'
      || !header.mrfLocationName.includes('Oaklawn Hospital')
      || !header.mrfAddress.includes('200 North Madison Street, Marshall, MI 49068')
      || header.mrfLicenseState !== 'MI' || header.declaredLastUpdated !== '2026-03-27'
      || header.cmsVersion !== '3.0.0') throw new Error('Oaklawn proof changed or is incomplete');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${current.sha256}.bin`);
  fs.writeFileSync(samplePath, current.body);
  const proof = {
    ccn: '230217', official_domain: 'oaklawnhospital.org',
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_mrf_url: staleUrl, pointer_mrf_http_status: stale.status,
    source_page_url: pageUrl, source_page_sha256: page.sha256,
    identity_url: identityUrl, identity_sha256: identity.sha256,
    current_mrf_url: currentUrl, current_mrf_http_status: current.status,
    current_mrf_sha256: current.sha256, retained_bytes: current.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    archive_member: header.member, declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName, declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState, declared_date: header.declaredLastUpdated,
    version: header.cmsVersion, observed_at: current.checkedAt,
    next_action: 'Recheck the exact Oaklawn root-pointer ZIP target after a publisher update; retain the separate first-party page-linked ZIP and audit the complete archive independently.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-oaklawn-pointer-page-proof.json'),
    JSON.stringify({ disposition: 'pointer-target-404-current-page-archive', records: [proof] }, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: proof.ccn, stale_status: stale.status, current_status: current.status,
    sample_sha256: current.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
