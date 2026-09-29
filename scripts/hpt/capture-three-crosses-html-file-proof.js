'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const samples = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const pointerUrl = 'https://www.threecrossesregional.com/cms-hpt.txt';
const pageUrl = 'https://www.threecrossesregional.com/price_transparency.html';
const fileUrl = 'https://www.threecrossesregional.com/assets/pdf/TCRH-Standard%20Charges-MRF-05.05.25.csv';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  fs.mkdirSync(samples, { recursive: true });
  const [pointer, page, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 131072, { timeoutMs: 30000 })
  ]);
  const pointerText = pointer.body.toString('utf8');
  const pageText = page.body.toString('utf8');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed?.find(item => item.cmsVersion && item.mrfHospitalName && item.mrfAddress);
  if (pointer.status < 200 || pointer.status >= 300
      || !pointerText.includes('location-name: Three Crosses Regional Hospital LLC')
      || !pointerText.includes(`mrf-url: ${pageUrl}`)
      || page.status < 200 || page.status >= 300 || !pageText.includes('TCRH-Standard Charges-MRF-05.05.25.csv')
      || file.status < 200 || file.status >= 300 || file.body.length < 65536 || !header
      || header.cmsVersion !== '2.0.0' || header.mrfLicenseState !== 'CA'
      || header.declaredLastUpdated !== '2024-11-07'
      || header.mrfHospitalName !== 'Three Crosses Regional Hospital LLC'
      || header.mrfLocationName !== 'Three Crosses Regional Hospital'
      || header.mrfAddress !== '2560  Samaritan Drive, Las Cruces, NM 88001')
    throw new Error('Three Crosses evidence incomplete or changed');
  const sample = path.join(samples, `${file.sha256}.bin`);
  fs.writeFileSync(sample, file.body);
  const record = {
    ccn: '320091',
    disposition: 'pointer-links-html-download-page-with-file',
    official_domain: 'threecrossesregional.com',
    pointer_url: pointerUrl,
    pointer_http_status: pointer.status,
    pointer_sha256: sha(pointer.body),
    pointer_mrf_url: pageUrl,
    pointer_mrf_http_status: page.status,
    pointer_mrf_sha256: sha(page.body),
    file_url: fileUrl,
    file_http_status: file.status,
    file_sha256: file.sha256,
    file_content_range: file.headers['content-range'] || '',
    retained_bytes: file.body.length,
    retained_sample: path.relative(root, sample).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated,
    version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Retain this dated page-linked file as provenance; obtain a current CMS 3.0.0 file and publisher clarification for the license-column label before promotion.'
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-three-crosses-html-file-proof.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, file_sha256: record.file_sha256, pointer_sha256: record.pointer_sha256, declared_date: record.declared_date }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
