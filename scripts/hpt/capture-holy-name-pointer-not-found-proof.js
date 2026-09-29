'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'data/hpt-audit/reconciliation-holy-name-pointer-not-found-proof.json');
const samples = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const pricingUrl = 'https://www.holyname.org/HospitalCharges/';
const pointerUrl = 'https://holyname.org/cms-hpt.txt';
const pointerMrfUrl = 'https://www.holyname.org/HospitalCharges/resources/221487322-Holy-Name-standard-charges.csv';
const fileUrl = 'https://www.holyname.org/HospitalCharges/resources/221487322_holy-name_standardcharges.csv';
const sha = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
  const [pricing, pointer, target, file] = await Promise.all([
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pointerMrfUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 })
  ]);
  const pricingText = pricing.body.toString('utf8');
  const pointerText = pointer.body.toString('utf8');
  const targetText = target.body.toString('utf8');
  if (pricing.status < 200 || pricing.status >= 300
      || !pricingText.includes('Holy Name Medical Center')
      || !pricingText.includes('718 Teaneck Road') || !pricingText.includes('Teaneck, NJ 07666')
      || !pricingText.includes('221487322_holy-name_standardcharges.csv'))
    throw new Error('Holy Name first-party pricing page identity or file link changed');
  if (pointer.status < 200 || pointer.status >= 300
      || !pointerText.includes('location-name: Holy Name Medical Center')
      || !pointerText.includes(`mrf-url: ${pointerMrfUrl}`)
      || pointerText.includes(fileUrl))
    throw new Error('Holy Name exact root pointer changed');
  if (target.status !== 200 || !/text\/html/i.test(target.headers['content-type'] || '')
      || !/<title>404<\/title>/i.test(targetText)
      || !targetText.includes('404 - Page Not Found'))
    throw new Error('Holy Name pointer-declared CSV URL no longer renders the observed not-found page');
  if (file.status !== 206 || file.body.length !== 262144
      || !/^bytes 0-262143\//.test(file.headers['content-range'] || ''))
    throw new Error('Holy Name bounded current CSV retrieval changed');
  const parsed = await parsePayload(file.body, 'text/csv');
  const header = parsed.parsed?.find(item => item.cmsVersion && item.mrfHospitalName && item.mrfAddress);
  if (!header || header.mrfHospitalName !== 'Holy Name'
      || header.mrfLocationName !== 'Holy Name Medical Center'
      || header.mrfAddress !== '718 Teaneck Road, Teaneck, NJ 07666'
      || header.mrfLicenseState !== 'NJ' || header.declaredLastUpdated !== '2025-11-10'
      || header.cmsVersion !== '3.0.0')
    throw new Error('Holy Name CSV exact-campus identity or metadata changed');
  const digest = sha(file.body);
  fs.mkdirSync(samples, { recursive: true });
  const sample = path.join(samples, `${digest}.bin`);
  fs.writeFileSync(sample, file.body);
  const record = {
    ccn: '310008', disposition: 'pointer-file-like-url-renders-not-found-official-page-links-current-file',
    official_domain: 'holyname.org', pricing_url: pricingUrl,
    pricing_http_status: pricing.status, pricing_sha256: sha(pricing.body),
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: sha(pointer.body),
    pointer_location_name: 'Holy Name Medical Center', pointer_mrf_url: pointerMrfUrl,
    pointer_mrf_http_status: target.status, pointer_mrf_content_type: target.headers['content-type'],
    pointer_mrf_sha256: sha(target.body), pointer_mrf_html_title: '404',
    browser_pointer_target_observed_at: '2026-09-16T09:28:19Z',
    browser_pointer_target_heading: '404 - Page Not Found',
    browser_pointer_target_final_url: pointerMrfUrl,
    file_url: fileUrl, file_http_status: file.status,
    file_content_type: file.headers['content-type'], file_content_range: file.headers['content-range'],
    file_sha256: digest, retained_bytes: file.body.length,
    retained_sample: path.relative(root, sample).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Retain the current file linked on the official pricing page without calling it pointer-linked; recheck the pointer-declared URL after the publisher changes it.'
  };
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, disposition: record.disposition, retained_bytes: record.retained_bytes }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
