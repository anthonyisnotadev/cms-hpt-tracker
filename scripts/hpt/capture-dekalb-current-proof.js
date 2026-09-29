'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const samples = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const pointerUrl = 'https://dekalbregional.com/cms-hpt.txt';
const fileUrl = 'https://dekalbregional.com/wp-content/uploads/934333907_Dekalb-Regional-Medical-Center_standardcharges.csv';
const sourcePageUrl = 'https://dekalbregional.org/patients-visitors/financial-information/price-transparency/';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  fs.mkdirSync(samples, { recursive: true });
  const [pointer, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(fileUrl, 131072, { timeoutMs: 30000 })
  ]);
  const pointerText = pointer.body.toString('utf8');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed?.find(item => item.cmsVersion && item.mrfHospitalName && item.mrfAddress);
  if (pointer.status < 200 || pointer.status >= 300
      || !pointerText.includes('location-name: DeKalb Regional Medical Center')
      || !pointerText.includes(`mrf-url: https://dekalbregional.org/wp-content/uploads/934333907_Dekalb-Regional-Medical-Center_standardcharges.csv`)
      || file.status < 200 || file.status >= 300 || file.body.length < 65536 || !header
      || header.cmsVersion !== '3.0.0' || header.mrfLicenseState !== 'AL'
      || header.declaredLastUpdated !== '2026-08-20'
      || header.mrfHospitalName !== 'HH HEALTH SYSTEM DEKALB REGIONAL'
      || header.mrfLocationName !== 'HH HEALTH SYSTEM DEKALB REGIONAL MEDICAL CENTER'
      || header.mrfAddress !== '200 Medical Center Drive Fort Payne, AL 35968')
    throw new Error('DeKalb evidence incomplete or changed');
  const sample = path.join(samples, `${file.sha256}.bin`);
  fs.writeFileSync(sample, file.body);
  const record = {
    ccn: '010012',
    disposition: 'verified-current-mrf',
    official_domain: 'dekalbregional.com',
    source_page_url: sourcePageUrl,
    source_page_observation: 'Official DeKalb Regional price-transparency page states prices are correct as of August 20, 2026 and links the standard charge CSV.',
    pointer_url: pointerUrl,
    pointer_http_status: pointer.status,
    pointer_sha256: sha(pointer.body),
    file_url: fileUrl,
    file_http_status: file.status,
    file_sha256: file.sha256,
    file_content_range: file.headers['content-range'] || '',
    file_content_length: file.headers['content-range']?.split('/')[1] || file.headers['content-length'] || '',
    retained_bytes: file.body.length,
    retained_sample: path.relative(root, sample).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated,
    version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Retain the hash-bound pointer and bounded header; recheck the publisher route after a material source change.'
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-dekalb-current-proof.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, file_sha256: record.file_sha256, retained_bytes: record.retained_bytes, declared_date: record.declared_date }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
