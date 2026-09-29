'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'data/hpt-audit/reconciliation-hughston-pointer-mismatch-proof.json');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const sourcePage = 'https://al.hughston.com/jack-hughston-memorial-hospital/price-transparency/';
const pointer = 'https://al.hughston.com/cms-hpt.txt';
const pointerMrf = 'https://al.hughston.com/wp-content/uploads/sites/8/2024/02/331058243_jack-hughston-memorial-hospital_standardcharges.json';
const pageMrf = 'https://al.hughston.com/wp-content/uploads/sites/8/2024/11/331058243_jack-hughston-memorial-hospital_standardcharges.json';

(async () => {
  fs.mkdirSync(sampleDir, { recursive: true });
  const [page, pointerResult, file] = await Promise.all([
    retrieve(sourcePage, 262144, { timeoutMs: 30000 }),
    retrieve(pointer, 65536, { timeoutMs: 30000 }),
    retrieve(pageMrf, 524288, { timeoutMs: 30000 }),
  ]);
  const pageText = page.body.toString('utf8');
  const pointerText = pointerResult.body.toString('utf8');
  if (page.status < 200 || page.status >= 300 || !pageText.includes(pageMrf)) throw new Error('Hughston source-page link changed');
  if (pointerResult.status < 200 || pointerResult.status >= 300 || !pointerText.includes(pointerMrf) || pointerText.includes(pageMrf)) throw new Error('Hughston pointer mismatch changed');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed.find((item) => item.mrfHospitalName && item.mrfLicenseState);
  if (file.status < 200 || file.status >= 300 || !header || header.mrfLicenseState !== 'AL' || header.cmsVersion !== '1.1.0' || !/Jack Hughston Memorial Hospital/i.test(header.mrfHospitalName)) {
    throw new Error('Hughston file proof incomplete');
  }
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '010168',
    disposition: 'official-page-mrf-differs-from-pointer-and-is-stale-template-v1',
    official_domain: 'al.hughston.com',
    official_homepage: 'https://al.hughston.com/jack-hughston-memorial-hospital/',
    official_address: '4401 Riverchase Drive, Phenix City, AL 36867',
    source_page_url: sourcePage,
    source_page_http_status: page.status,
    source_page_sha256: page.sha256,
    pointer_url: pointer,
    pointer_http_status: pointerResult.status,
    pointer_sha256: pointerResult.sha256,
    pointer_mrf_url: pointerMrf,
    current_mrf_url: pageMrf,
    current_mrf_http_status: file.status,
    current_mrf_sha256: file.sha256,
    retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    total_file_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_state: header.mrfLicenseState,
    declared_state_source: 'root license_information[0].state',
    declared_date: header.declaredLastUpdated,
    version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Retain the exact official-page file and facility metadata, but do not promote it: it is over 365 days old, declares CMS 1.1.0, and differs from the older file URL in the current root pointer. Recheck the page and pointer for a current aligned file.',
  };
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
