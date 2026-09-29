'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const oldRootUrl = 'https://lexmed.com/cms-hpt.txt';
const pointerUrl = 'https://lexhealth.com/cms-hpt.txt';
const pageUrl = 'https://lexhealth.com/billing-insurance/price-transparency';
const identityUrl = 'https://lexhealth.com/locations/details/lexington-medical-center';
const fileUrl = 'https://lexhealth.com/lexhealth/docs/852276567_lexington-medical-center_standardcharges-Q2-2026.json';

async function main() {
  const [oldRoot, pointer, page, identity, file] = await Promise.all([
    retrieve(oldRootUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 65536, { timeoutMs: 30000 }),
    retrieve(identityUrl, 65536, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerTitle = cheerio.load(pointer.body.toString('utf8'))('title').first().text().trim();
  const $ = cheerio.load(page.body.toString('utf8'));
  const links = $('a').map((_, a) => new URL($(a).attr('href') || '', pageUrl).href).get()
    .filter(url => url === fileUrl);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const header = (await parsePayload(file.body, file.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'json' && item.mrfHospitalName);
  if (oldRoot.status !== 200 || oldRoot.finalUrl !== pointer.finalUrl
      || pointer.status !== 200 || !String(pointer.headers['content-type']).startsWith('text/html')
      || !/\/404(?:\?|$)/.test(pointer.finalUrl)
      || pointerTitle !== '404 - Page Not Found'
      || page.status !== 200 || links.length !== 1
      || identity.status !== 200 || !identityText.includes('Lexington Medical Center')
      || !identityText.includes('2720 Sunset Blvd.') || !identityText.includes('West Columbia, 29169')
      || file.status !== 206 || file.body.length !== 262144
      || !header || header.mrfHospitalName !== 'Lexington Medical Center'
      || header.mrfLocationName !== 'Lexington Medical Center'
      || header.mrfAddress !== '2720 Sunset Blvd, West Columbia, SC 29169'
      || header.mrfLicenseState !== 'SC' || header.declaredLastUpdated !== '2026-04-01'
      || header.cmsVersion !== '3.0.0') {
    throw new Error('Current Lexington root/page/file proof changed');
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '420073', official_domain: 'lexhealth.com',
    old_root_url: oldRootUrl, old_root_final_url: oldRoot.finalUrl,
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_final_url: pointer.finalUrl,
    pointer_response_content_type: pointer.headers['content-type'],
    pointer_response_title: pointerTitle, pointer_response_sha256: pointer.sha256,
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
    next_action: 'Recheck the current Lexington Health root cms-hpt.txt path after publisher change; retain the current page-linked file and do not call the HTML 404 page a usable pointer or infer compliance.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-lexington-soft-root-proof.json'),
    `${JSON.stringify({ disposition: 'official-page-file-root-html-soft-not-found', record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, root: record.pointer_http_status,
    finalUrl: record.pointer_final_url, file: record.current_mrf_http_status,
    sha256: record.current_mrf_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
