'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const oldPointerUrl = 'https://swedishcovenant.org/cms-hpt.txt';
const pointerUrl = 'https://www.endeavorhealth.org/cms-hpt.txt';
const pageUrl = 'https://www.endeavorhealth.org/patients-visitors/billing-insurance/price-transparency';
const fileUrl = 'https://www.endeavorhealth.org/362179813_1831151257_swedish-covenant-health_standardcharges.json';
const identityUrl = 'https://www.endeavorhealth.org/locations/swedish-hospital';

async function main() {
  const [oldPointer, pointer, page, file, identity] = await Promise.all([
    retrieve(oldPointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const oldText = oldPointer.body.toString('utf8');
  const pointerText = pointer.body.toString('utf8');
  const $ = cheerio.load(page.body.toString('utf8'));
  const links = $('a').map((_, a) => ({ text: $(a).text().trim(),
    url: new URL($(a).attr('href') || '', pageUrl).href })).get();
  const matchingLinks = links.filter(link => link.text === 'Swedish Hospital' && link.url === fileUrl);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const header = (await parsePayload(file.body, file.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'json' && item.mrfHospitalName);
  if (![200, 206].includes(oldPointer.status) || oldPointer.finalUrl !== 'https://www.endeavorhealth.org/'
      || !String(oldPointer.headers['content-type']).startsWith('text/html')
      || !oldText.includes('<html')
      || ![200, 206].includes(pointer.status)
      || !String(pointer.headers['content-type']).startsWith('text/plain')
      || !pointerText.includes('location-name: Endeavor Health Swedish Hospital')
      || !pointerText.includes(`mrf-url: ${fileUrl}`)
      || ![200, 206].includes(page.status) || matchingLinks.length !== 1
      || ![200, 206].includes(identity.status)
      || !identityText.includes('Swedish Hospital')
      || !identityText.includes('5145 N. California Ave.')
      || !identityText.includes('Chicago, IL 60625')
      || file.status !== 200 || file.body.length !== 262144
      || !header || header.mrfHospitalName !== 'Swedish Covenant Health'
      || header.mrfLocationName !== 'Endeavor Health Swedish Hospital'
      || header.mrfAddress !== '5145 N California Ave, Chicago, IL 60625'
      || header.mrfLicenseState !== 'IL'
      || header.declaredLastUpdated !== '2026-04-01' || header.cmsVersion !== '3.0.0') {
    throw new Error('Current Endeavor Swedish pointer/file proof changed');
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '140114', official_domain: 'endeavorhealth.org',
    old_pointer_url: oldPointerUrl, old_pointer_http_status: oldPointer.status,
    old_pointer_final_url: oldPointer.finalUrl, old_pointer_content_type: oldPointer.headers['content-type'],
    old_pointer_response_sha256: oldPointer.sha256,
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, pointer_location_name: 'Endeavor Health Swedish Hospital',
    source_page_url: pageUrl, source_page_sha256: page.sha256,
    official_identity_url: identityUrl, official_identity_sha256: identity.sha256,
    mrf_url: fileUrl, mrf_http_status: file.status, mrf_sha256: file.sha256,
    retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Keep the old Swedish Covenant root-path redirect as historical access evidence; monitor Endeavor root pointer and exact Swedish file for publisher changes. Bounded header proof does not constitute full-file validation.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-endeavor-swedish-pointer-file-proof.json'),
    `${JSON.stringify({ disposition: 'current-first-party-pointer-linked-file-after-domain-move', record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, oldRedirect: record.old_pointer_final_url,
    pointer: record.pointer_http_status, file: record.mrf_http_status, sha256: record.mrf_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
