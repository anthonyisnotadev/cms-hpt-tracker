'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'data/hpt-audit/reconciliation-baldwin-health-proof.json');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const pageUrl = 'https://www.baldwinhealth.com/pricing-information';
const pointerUrl = 'https://www.baldwinhealth.com/cms-hpt.txt';
const fileUrl = 'https://www.baldwinhealth.com/Uploads/Public/Documents/charge-masters/charge-masters-2024/621811413_south-baldwin-regional-medical-center_standardcharges.csv';

(async () => {
  fs.mkdirSync(sampleDir, { recursive: true });
  const [page, pointer, file] = await Promise.all([
    retrieve(pageUrl, 524288, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(fileUrl, 1048576, { timeoutMs: 30000 }),
  ]);
  const pageText = page.body.toString('utf8');
  const pointerText = pointer.body.toString('utf8');
  if (page.status < 200 || page.status >= 300 || !pageText.includes(new URL(fileUrl).pathname)
      || !pageText.includes('1613 N. McKenzie Street')) throw new Error('Baldwin official page identity or file link changed');
  if (pointer.status < 200 || pointer.status >= 300 || !pointerText.includes('location-name: Baldwin Health')
      || !pointerText.includes(`source-page-url: ${pageUrl}`) || !pointerText.includes(`mrf-url: ${fileUrl}`)) {
    throw new Error('Baldwin root pointer changed');
  }
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed.find(item => item.mrfLocationName && item.mrfAddress && item.mrfLicenseState);
  if (file.status < 200 || file.status >= 300 || !header || header.cmsVersion !== '3.0.0'
      || header.declaredLastUpdated !== '2026-04-01' || header.mrfLicenseState !== 'AL'
      || !/Baldwin Health/i.test(header.mrfLocationName) || !/1613 N\. McKenzie Street/i.test(header.mrfAddress)) {
    throw new Error('Baldwin file proof incomplete');
  }
  const totalBytes = Number((file.headers['content-range'] || '').split('/')[1]) || null;
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '010083', disposition: 'verified-current-pointer-linked-mrf', official_domain: 'baldwinhealth.com',
    official_page_url: pageUrl, official_page_sha256: page.sha256,
    pointer_url: pointerUrl, pointer_final_url: pointer.finalUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, pointer_location_name: 'Baldwin Health', pointer_mrf_url: fileUrl,
    current_mrf_url: fileUrl, current_mrf_http_status: file.status, current_mrf_sha256: file.sha256,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    total_file_bytes: totalBytes, declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName, declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState, declared_date: header.declaredLastUpdated,
    version: header.cmsVersion, observed_at: file.checkedAt,
    next_action: 'No unresolved identity, pointer, access or root-metadata action remains. Recheck on the normal update cadence.',
  };
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
