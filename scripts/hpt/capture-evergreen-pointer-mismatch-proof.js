'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'data/hpt-audit/reconciliation-evergreen-pointer-mismatch-proof.json');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const verificationPath = path.join(root, 'data/hpt-audit/nationwide-verification.json');
const sourcePage = 'https://www.evergreenmedical.org/patient-estimator';
const current = 'https://irp.cdn-website.com/1a9867e2/files/uploaded/208057151_evergreenmedicalcenter_standardcharges-8969ef83.csv';
const oldPointerMrf = 'https://irp.cdn-website.com/1a9867e2/files/uploaded/208057151_evergreenmedicalcenter_standardcharges.csv';
const sha = (body) => crypto.createHash('sha256').update(body).digest('hex');

(async () => {
  fs.mkdirSync(sampleDir, { recursive: true });
  const verification = JSON.parse(fs.readFileSync(verificationPath, 'utf8')).records.find((row) => row.ccn === '010148');
  if (!verification || verification.pointer_state !== 'retrieved-facility-linked' || verification.mrf_url !== oldPointerMrf) {
    throw new Error('Evergreen pointer evidence changed');
  }

  const [page, file] = await Promise.all([
    retrieve(sourcePage, 262144, { timeoutMs: 30000 }),
    retrieve(current, 262144, { timeoutMs: 30000 }),
  ]);
  const pageText = page.body.toString('utf8');
  if (page.status < 200 || page.status >= 300 || !pageText.includes(current)) {
    throw new Error('Evergreen source page does not expose the expected current link');
  }
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed.find((item) => item.mrfHospitalName && item.mrfAddress && item.mrfLicenseState);
  if (file.status < 200 || file.status >= 300 || !header || header.mrfLicenseState !== 'AL' || header.cmsVersion !== '2.0.0' || !/101 Crestview Ave/i.test(header.mrfAddress)) {
    throw new Error('Evergreen file proof incomplete');
  }

  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '010148',
    disposition: 'official-page-mrf-differs-from-pointer-and-is-stale-template-v2',
    official_domain: 'evergreenmedical.org',
    official_homepage: 'https://www.evergreenmedical.org/',
    source_page_url: sourcePage,
    source_page_http_status: page.status,
    source_page_sha256: sha(page.body),
    pointer_url: 'https://evergreenmedical.org/cms-hpt.txt',
    pointer_sha256: verification.evidence.pointer_sha256s[0],
    pointer_mrf_url: oldPointerMrf,
    current_mrf_url: current,
    current_mrf_http_status: file.status,
    current_mrf_sha256: file.sha256,
    retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    total_file_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated,
    version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Retain the official-page file and exact identity metadata, but do not promote it: it is over 365 days old, declares CMS 2.0.0, and differs from the file linked by the current root pointer. Recheck the page and pointer for a current aligned file.',
  };
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
