'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'data/hpt-audit/reconciliation-southwoods-html-pointer-proof.json');
const samples = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const identityUrl = 'https://www.southwoodshealth.com/locations/';
const pointerUrl = 'https://southwoodshealth.com/cms-hpt.txt';
const pageUrl = 'https://www.southwoodshealth.com/pricing-transparency/';
const fileUrl = 'https://www.southwoodshealth.com/wp-content/uploads/2026/04/421562638_surgery-center-at-southwoods_standardcharges.csv';
const campus = '7630 SOUTHERN BLVD, YOUNGSTOWN, OH 44512';
const sha = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
  fs.mkdirSync(samples, { recursive: true });
  const [identity, pointer, page, file] = await Promise.all([
    retrieve(identityUrl, 524288, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 524288, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 })
  ]);
  const identityText = identity.body.toString('utf8');
  const pointerText = pointer.body.toString('utf8');
  const pageText = page.body.toString('utf8');
  if (identity.status < 200 || identity.status >= 300 || !identityText.includes('The Surgical Hospital at Southwoods')
      || !identityText.includes('7630 Southern Blvd.') || !identityText.includes('Boardman, OH 44512'))
    throw new Error('Southwoods exact-campus identity page changed');
  if (pointer.status < 200 || pointer.status >= 300 || !pointerText.includes('location-name: Surgical Hospital at Southwoods')
      || !pointerText.includes(`mrf-url: ${pageUrl}`) || pointerText.includes(fileUrl))
    throw new Error('Southwoods pointer no longer labels the price page as its MRF');
  if (page.status < 200 || page.status >= 300 || !/text\/html/i.test(page.headers['content-type'] || '')
      || !pageText.includes(fileUrl) || !pageText.includes('Standard Charges All Locations of the Surgical Hospital at Southwoods'))
    throw new Error('Southwoods price page does not label/link the expected shared CSV');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed?.find(item => item.cmsVersion && item.mrfHospitalName && item.mrfAddress);
  if (file.status < 200 || file.status >= 300 || file.body.length < 65536 || !header
      || header.cmsVersion !== '3.0.0' || header.mrfLicenseState !== 'OH'
      || header.declaredLastUpdated !== '2026-02-17'
      || header.mrfHospitalName !== 'Surgery Center at Southwoods, LLC'
      || !header.mrfLocationName.includes('All Locations')
      || !header.mrfAddress.split('|').includes(campus))
    throw new Error('Southwoods shared CSV does not include the exact hospital campus');
  const digest = sha(file.body);
  const sample = path.join(samples, `${digest}.bin`);
  fs.writeFileSync(sample, file.body);
  const record = {
    ccn: '360352', disposition: 'pointer-mrf-url-is-html-page-linking-current-multi-location-file',
    official_domain: 'southwoodshealth.com', identity_url: identityUrl,
    identity_http_status: identity.status, identity_sha256: sha(identity.body),
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: sha(pointer.body),
    pointer_location_name: 'Surgical Hospital at Southwoods', pointer_mrf_url: pageUrl,
    page_http_status: page.status, page_content_type: page.headers['content-type'], page_sha256: sha(page.body),
    file_url: fileUrl, file_http_status: file.status, file_sha256: digest,
    retained_bytes: file.body.length, retained_sample: path.relative(root, sample).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, exact_campus_address: campus,
    declared_state: header.mrfLicenseState, declared_date: header.declaredLastUpdated,
    version: header.cmsVersion, observed_at: file.checkedAt,
    next_action: 'Retain exact-campus evidence from the shared CSV without applying it to other facilities; recheck the root pointer after a publisher change.'
  };
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, disposition: record.disposition, retained_bytes: record.retained_bytes }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
