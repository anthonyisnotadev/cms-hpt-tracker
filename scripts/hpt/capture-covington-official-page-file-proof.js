'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://covingtoncountyhospital.com/cms-hpt.txt';
const pageUrl = 'https://covingtoncountyhospital.com/pricing-transparency/';
const identityUrl = 'https://covingtoncountyhospital.com/contact-us/';
const fileUrl = 'https://covingtoncountyhospital.com/646001549_covington-county-hospital_standardcharges.csv';

async function main() {
  const [pointer, page, identity, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const $ = cheerio.load(page.body.toString('utf8'));
  const pageText = $('body').text().replace(/\s+/g, ' ');
  const links = $('a').map((_, a) => new URL($(a).attr('href') || '', pageUrl).href).get()
    .filter(url => url === fileUrl);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const header = (await parsePayload(file.body, file.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (pointer.status !== 404 || !String(pointer.headers['content-type']).startsWith('text/html')
      || ![200, 206].includes(page.status) || links.length !== 1
      || !pageText.includes('701 South Holly Avenue Collins, Mississippi 39428')
      || ![200, 206].includes(identity.status)
      || !identityText.includes('701 South Holly Avenue')
      || !identityText.includes('Collins, Mississippi 39428')
      || file.status !== 206 || file.body.length !== 262144
      || !header || header.mrfHospitalName !== 'covington_county_hospital'
      || header.mrfLocationName !== 'covington_county_hospital_.1'
      || header.mrfAddress !== '701_south_holly_avenue_collins_ms_39428'
      || header.mrfLicenseState !== 'MS'
      || header.declaredLastUpdated !== '2026-07-21' || header.cmsVersion !== '3.0.0') {
    throw new Error('Current Covington official-page/file proof changed');
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '251325', official_domain: 'covingtoncountyhospital.com',
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_response_content_type: pointer.headers['content-type'], pointer_response_sha256: pointer.sha256,
    source_page_url: pageUrl, source_page_sha256: page.sha256,
    official_identity_url: identityUrl, official_identity_sha256: identity.sha256,
    current_mrf_url: fileUrl, current_mrf_http_status: file.status,
    current_mrf_sha256: file.sha256, retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    page_has_unrelated_outbound_footer_links: /hacklink|casibom|marsbahis/i.test(pageText),
    observed_at: file.checkedAt,
    next_action: 'Recheck the exact official-domain root pointer after publisher change. Keep the page-linked file and unusual raw location-name field separate from pointer/compliance verification; review unrelated outbound footer links with site owner before relying on broader page content.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-covington-official-page-file-proof.json'),
    `${JSON.stringify({ disposition: 'official-page-file-root-pointer-404', record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, root: record.pointer_http_status,
    file: record.current_mrf_http_status, sha256: record.current_mrf_sha256,
    unrelatedFooterLinks: record.page_has_unrelated_outbound_footer_links }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
