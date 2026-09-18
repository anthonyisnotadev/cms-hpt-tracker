'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'data/hpt-audit/reconciliation-russell-official-page-file-proof.json');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const pageUrl = 'https://www.russellcares.com/price-transparency';
const pointerUrl = 'https://www.russellcares.com/cms-hpt.txt';
const fileUrl = 'https://rm.121cms.com/wp-content/uploads/630385130_russell-medical-center__standardcharges-1-1.csv';

(async () => {
  fs.mkdirSync(sampleDir, { recursive: true });
  const [page, pointer, file] = await Promise.all([
    retrieve(pageUrl, 524288, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 1048576, { timeoutMs: 30000 }),
  ]);
  const pageText = page.body.toString('utf8');
  if (page.status < 200 || page.status >= 300 || !pageText.includes(fileUrl)
      || !pageText.includes('3316 Hwy 280')) throw new Error('Russell official page identity or file link changed');
  if (pointer.status !== 404) throw new Error('Russell root pointer result changed');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed.find(item => item.mrfHospitalName && item.mrfAddress && item.mrfLicenseState);
  if (file.status < 200 || file.status >= 300 || !header || header.cmsVersion !== '2.0.0'
      || header.declaredLastUpdated !== '2025-06-15' || header.mrfLicenseState !== 'AL'
      || !/Russell Medical Center/i.test(header.mrfHospitalName) || !/3316 Hwy 280/i.test(header.mrfAddress)) {
    throw new Error('Russell file proof incomplete');
  }
  const totalBytes = Number((file.headers['content-range'] || '').split('/')[1]) || null;
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '010065', disposition: 'official-page-stale-v2-mrf-root-pointer-404',
    official_domain: 'russellcares.com', official_page_url: pageUrl, official_page_sha256: page.sha256,
    pointer_url: pointerUrl, pointer_final_url: pointer.finalUrl, pointer_http_status: pointer.status,
    pointer_content_type: pointer.headers['content-type'] || '', pointer_sha256: pointer.sha256,
    current_mrf_url: fileUrl, current_mrf_final_url: file.finalUrl, current_mrf_http_status: file.status,
    current_mrf_sha256: file.sha256, retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'), total_file_bytes: totalBytes,
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion, observed_at: file.checkedAt,
    next_action: 'Retain the exact official-page file and its stale/version metadata, but do not call it pointer-linked. Recheck only after the official page file URL changes or the root cms-hpt.txt begins returning a usable pointer.',
  };
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
