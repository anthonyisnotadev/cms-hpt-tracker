'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'data/hpt-audit/reconciliation-lawrence-memorial-official-page-proof.json');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const pageUrl = 'https://lawrencememorial.info/price-transparency';
const identityUrl = 'https://lawrencememorial.info/contact-us';
const pointerUrl = 'https://lawrencememorial.info/cms-hpt.txt';
const fileUrl = 'https://lawrencememorial.info/storage/cms/library/documents/731547175_lawrence-memorial-health-foundation-inc_standardcharges.csv';

(async () => {
  fs.mkdirSync(sampleDir, { recursive: true });
  const [page, identity, pointer, file] = await Promise.all([
    retrieve(pageUrl, 524288, { timeoutMs: 30000 }),
    retrieve(identityUrl, 524288, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 1048576, { timeoutMs: 30000 }),
  ]);
  const pageText = page.body.toString('utf8');
  const identityText = identity.body.toString('utf8');
  if (page.status < 200 || page.status >= 300 || !pageText.includes(new URL(fileUrl).pathname)
      || !/Lawrence Memorial Hospital/i.test(pageText)) throw new Error('Lawrence official page or file link changed');
  if (identity.status < 200 || identity.status >= 300 || !/1309 West Main/i.test(identityText)
      || !/Walnut Ridge/i.test(identityText)) throw new Error('Lawrence official identity page changed');
  if (pointer.status !== 404) throw new Error('Lawrence root pointer result changed');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed.find(item => item.mrfLocationName && item.mrfAddress && item.mrfLicenseState);
  if (file.status < 200 || file.status >= 300 || !header || header.cmsVersion !== '3.0.0'
      || header.declaredLastUpdated !== '2025-12-22' || header.mrfLicenseState !== 'AR'
      || !/Lawrence Memorial Hospital/i.test(header.mrfLocationName)
      || !/1309 W MAIN, WALNUT RIDGE, AR 72476/i.test(header.mrfAddress)) {
    throw new Error('Lawrence file proof incomplete');
  }
  const totalBytes = Number((file.headers['content-range'] || '').split('/')[1]) || null;
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '041309', disposition: 'official-page-current-v3-mrf-root-pointer-404',
    official_domain: 'lawrencememorial.info', official_page_url: pageUrl,
    official_page_sha256: page.sha256, identity_page_url: identityUrl,
    identity_page_sha256: identity.sha256, pointer_url: pointerUrl,
    pointer_final_url: pointer.finalUrl, pointer_http_status: pointer.status,
    pointer_content_type: pointer.headers['content-type'] || '', pointer_sha256: pointer.sha256,
    current_mrf_url: fileUrl, current_mrf_final_url: file.finalUrl,
    current_mrf_http_status: file.status, current_mrf_sha256: file.sha256,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    total_file_bytes: totalBytes, declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName, declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState, declared_date: header.declaredLastUpdated,
    version: header.cmsVersion, observed_at: file.checkedAt,
    next_action: 'Retain the exact official-page file and current metadata without calling it pointer-linked. Recheck only after the official page file changes or the root cms-hpt.txt begins returning a usable pointer.',
  };
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
