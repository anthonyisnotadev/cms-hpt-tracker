'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'data/hpt-audit/reconciliation-bibb-current-file-proof.json');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const pageUrl = 'https://www.bibbmedicalcenter.com/patientresources';
const pointerUrl = 'https://www.bibbmedicalcenter.com/cms-hpt.txt';
const fileUrl = 'https://www.bibbmedicalcenter.com/_files/ugd/7e0044_cfc8941aea9f4e33a01d9d33599258da.csv?dn=636005283_bibb-medical-center_standardcharges.csv';

(async () => {
  fs.mkdirSync(sampleDir, { recursive: true });
  const [page, pointer, file] = await Promise.all([
    retrieve(pageUrl, 2 * 1048576, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 1048576, { timeoutMs: 30000 }),
  ]);
  const pageText = page.body.toString('utf8');
  if (page.status < 200 || page.status >= 300 || !pageText.includes('636005283_bibb-medical-center_standardcharges.csv')
      || !pageText.includes('208 Pierson Avenue')) throw new Error('Bibb official page identity or file link changed');
  if (pointer.status !== 400) throw new Error('Bibb root pointer result changed');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed.find(item => item.mrfHospitalName && item.mrfAddress && item.mrfLicenseState);
  if (file.status < 200 || file.status >= 300 || !header || header.cmsVersion !== '3.0.0'
      || header.declaredLastUpdated !== '2026-02-11' || header.mrfLicenseState !== 'AL'
      || !/Bibb Medical Center/i.test(header.mrfHospitalName) || !/208 Pierson Avenue/i.test(header.mrfAddress)) {
    throw new Error('Bibb file proof incomplete');
  }
  const totalBytes = Number((file.headers['content-range'] || '').split('/')[1])
    || Number(file.headers['content-length']) || file.body.length;
  if (file.body.length !== totalBytes) throw new Error('Bibb CSV was not retained completely');
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '010058',
    disposition: 'official-page-current-mrf-root-pointer-http-error',
    official_domain: 'bibbmedicalcenter.com',
    official_page_url: pageUrl,
    official_page_sha256: page.sha256,
    pointer_url: pointerUrl,
    pointer_final_url: pointer.finalUrl,
    pointer_http_status: pointer.status,
    pointer_content_type: pointer.headers['content-type'] || '',
    pointer_sha256: pointer.sha256,
    current_mrf_url: fileUrl,
    current_mrf_final_url: file.finalUrl,
    current_mrf_http_status: file.status,
    current_mrf_sha256: file.sha256,
    retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    total_file_bytes: totalBytes,
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated,
    version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Retain the current exact identity-matched MRF, but do not call it pointer-linked while the root cms-hpt.txt request returns HTTP 400. Recheck the root pointer after the official page or file changes.',
  };
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
