'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'data/hpt-audit/reconciliation-bucktail-html-pointer-proof.json');
const samples = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const identityUrl = 'https://bucktailmedicalcenter.org/price-transparency/';
const pointerUrl = 'https://bucktailmedicalcenter.org/cms-hpt.txt';
const pageUrl = 'https://bucktailmedicalcenter.kinsta.cloud/price-transparency/';
const fileUrl = 'https://bucktailmedicalcenter.org/wp-content/uploads/2026/04/240701920_bucktail-medical-center_standardcharges-1.zip';
const sha = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
  fs.mkdirSync(samples, { recursive: true });
  const [identity, pointer, page, file] = await Promise.all([
    retrieve(identityUrl, 524288, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 524288, { timeoutMs: 30000 }),
    retrieve(fileUrl, 1048576, { timeoutMs: 30000 })
  ]);
  const identityText = identity.body.toString('utf8');
  const pointerText = pointer.body.toString('utf8');
  const pageText = page.body.toString('utf8');
  const fileName = '240701920_bucktail-medical-center_standardcharges-1.zip';
  if (identity.status < 200 || identity.status >= 300 || !identityText.includes('Bucktail Medical Center')
      || !identityText.includes('1001 Pine St') || !identityText.includes('Renovo, PA 17764')
      || !identityText.includes(fileName))
    throw new Error('Bucktail official identity/pricing page changed');
  if (pointer.status < 200 || pointer.status >= 300 || !pointerText.includes('location-name: Bucktail Medical Center')
      || !pointerText.includes(`mrf-url: ${pageUrl}`) || pointerText.includes(fileUrl))
    throw new Error('Bucktail pointer no longer labels the HTML page as its MRF');
  if (page.status < 200 || page.status >= 300 || !/text\/html/i.test(page.headers['content-type'] || '')
      || !pageText.includes(fileName))
    throw new Error('Bucktail pointer-target pricing page does not link the ZIP');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed?.find(item => item.cmsVersion && item.mrfHospitalName && item.mrfAddress);
  if (file.status < 200 || file.status >= 300 || file.body.length < 65536 || !header
      || header.cmsVersion !== '3.0.0' || header.mrfLicenseState !== 'PA'
      || header.declaredLastUpdated !== '2026-03-29'
      || !/Bucktail Medical Center/i.test(header.mrfHospitalName)
      || !/Bucktail Medical Center/i.test(header.mrfLocationName)
      || !/1001 Pine Street, Renovo, PA, 17764/i.test(header.mrfAddress))
    throw new Error('Bucktail ZIP identity or metadata mismatch');
  const digest = sha(file.body);
  const sample = path.join(samples, `${digest}.bin`);
  fs.writeFileSync(sample, file.body);
  const record = {
    ccn: '391304', disposition: 'pointer-mrf-url-is-html-page-linking-current-identity-matched-zip',
    official_domain: 'bucktailmedicalcenter.org', identity_url: identityUrl,
    identity_http_status: identity.status, identity_sha256: sha(identity.body),
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: sha(pointer.body),
    pointer_location_name: 'Bucktail Medical Center', pointer_mrf_url: pageUrl,
    page_http_status: page.status, page_content_type: page.headers['content-type'], page_sha256: sha(page.body),
    file_url: fileUrl, file_http_status: file.status, file_sha256: digest,
    retained_bytes: file.body.length, retained_sample: path.relative(root, sample).replaceAll('\\', '/'),
    member: header.member, declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName, declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState, declared_date: header.declaredLastUpdated,
    version: header.cmsVersion, observed_at: file.checkedAt,
    next_action: 'Retain the ZIP-linked file evidence without calling it directly pointer-linked; recheck the exact pointer after a publisher change.'
  };
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, disposition: record.disposition, retained_bytes: record.retained_bytes }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
