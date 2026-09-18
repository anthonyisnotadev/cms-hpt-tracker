'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'data/hpt-audit/reconciliation-mineral-html-pointer-proof.json');
const samples = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const identityUrl = 'https://mineralcommunityhospital.com/contact/';
const pointerUrl = 'https://mineralcommunityhospital.com/cms-hpt.txt';
const pageUrl = 'https://mineralcommunityhospital.com/price-transparency/';
const fileUrl = 'https://mineralcommunityhospital.com/wp-content/uploads/2025/04/810421823_Mineral-Community-Hospital_standardcharges07.2024-3.csv';
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
  if (identity.status < 200 || identity.status >= 300 || !identityText.includes('Mineral Community Hospital')
      || !identityText.includes('1208 6th Ave East') || !identityText.includes('Superior, Montana 59872'))
    throw new Error('Mineral facility identity page changed');
  if (pointer.status < 200 || pointer.status >= 300 || !pointerText.includes('location-name: Mineral Community Hospital')
      || !pointerText.includes(`mrf-url: ${pageUrl}`) || pointerText.includes(fileUrl))
    throw new Error('Mineral pointer no longer labels the price page as its MRF');
  if (page.status < 200 || page.status >= 300 || !/text\/html/i.test(page.headers['content-type'] || '')
      || !pageText.includes(fileUrl))
    throw new Error('Mineral price page does not link the expected CSV');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed?.find(item => item.cmsVersion && item.mrfHospitalName && item.mrfAddress);
  if (file.status < 200 || file.status >= 300 || file.body.length < 65536 || !header
      || header.cmsVersion !== '2.0.0' || header.mrfLicenseState !== 'MT'
      || header.declaredLastUpdated !== '2024-07-01'
      || header.mrfHospitalName !== 'Mineral Community Hospital'
      || header.mrfLocationName !== 'Mineral Community Hospital'
      || header.mrfAddress !== '1208 6th Ave East, Superior MT  59872')
    throw new Error('Mineral CSV identity or metadata mismatch');
  const digest = sha(file.body);
  const sample = path.join(samples, `${digest}.bin`);
  fs.writeFileSync(sample, file.body);
  const record = {
    ccn: '271331', disposition: 'pointer-mrf-url-is-html-page-linking-stale-v2-file',
    official_domain: 'mineralcommunityhospital.com', identity_url: identityUrl,
    identity_http_status: identity.status, identity_sha256: sha(identity.body),
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: sha(pointer.body),
    pointer_location_name: 'Mineral Community Hospital', pointer_mrf_url: pageUrl,
    page_http_status: page.status, page_content_type: page.headers['content-type'], page_sha256: sha(page.body),
    file_url: fileUrl, file_http_status: file.status, file_sha256: digest,
    retained_bytes: file.body.length, retained_sample: path.relative(root, sample).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Retain the page-linked stale 2.0.0 file as observed evidence; recheck the exact pointer and pricing-page file only after a publisher change.'
  };
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, disposition: record.disposition, retained_bytes: record.retained_bytes }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
