'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'data/hpt-audit/reconciliation-onslow-html-pointer-proof.json');
const samples = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const identityUrl = 'https://www.onslow.org/';
const pointerUrl = 'https://onslow.org/cms-hpt.txt';
const portalUrl = 'https://search.hospitalpriceindex.com/hpi2/machineReadable/onslowmemorialhospital/11821';
const fileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/11821/562014989_onslow-memorial-hospital%2C-inc_standardcharges.csv';
const sha = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
  const [identity, pointer, portal, file] = await Promise.all([
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(portalUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 })
  ]);
  const identityText = identity.body.toString('utf8');
  const pointerText = pointer.body.toString('utf8');
  if (identity.status < 200 || identity.status >= 300
      || !identityText.includes('Onslow Memorial Hospital')
      || !identityText.includes('Western Boulevard') || !identityText.includes('Jacksonville')
      || !identityText.includes('North Carolina') || !identityText.includes('28546'))
    throw new Error('Onslow first-party facility identity or address changed');
  if (pointer.status < 200 || pointer.status >= 300
      || !/location-name:\s*Onslow Memorial Hospital\b/.test(pointerText)
      || !pointerText.includes(portalUrl) || pointerText.includes(fileUrl))
    throw new Error('Onslow exact root pointer changed');
  if (portal.status < 200 || portal.status >= 300
      || !/text\/html/i.test(portal.headers['content-type'] || ''))
    throw new Error('Onslow pointer target is no longer HTML');
  if (file.status !== 206 || file.body.length !== 262144
      || !/^bytes 0-262143\//.test(file.headers['content-range'] || ''))
    throw new Error('Onslow bounded CSV retrieval changed');
  const parsed = await parsePayload(file.body, 'text/csv');
  const header = parsed.parsed?.find(item => item.cmsVersion && item.mrfHospitalName && item.mrfAddress);
  if (!header || header.mrfHospitalName !== 'Onslow Memorial Hospital, Inc'
      || header.mrfLocationName !== 'Onslow Memorial Hospital, Inc.'
      || header.mrfAddress !== '317 Western Blvd, Jacksonville, NC 28546'
      || header.mrfLicenseState !== 'NC' || header.declaredLastUpdated !== '2026-04-28'
      || header.cmsVersion !== '3.0.0')
    throw new Error('Onslow CSV facility identity or metadata changed');
  const digest = sha(file.body);
  fs.mkdirSync(samples, { recursive: true });
  const sample = path.join(samples, `${digest}.bin`);
  fs.writeFileSync(sample, file.body);
  const record = {
    ccn: '340042', disposition: 'pointer-html-portal-links-current-exact-hospital-file',
    official_domain: 'onslow.org', identity_url: identityUrl,
    identity_http_status: identity.status, identity_sha256: sha(identity.body),
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: sha(pointer.body),
    pointer_location_name: 'Onslow Memorial Hospital', pointer_mrf_url: portalUrl,
    portal_http_status: portal.status, portal_content_type: portal.headers['content-type'],
    portal_sha256: sha(portal.body),
    browser_portal_observed_at: '2026-09-16T09:15:15Z',
    browser_portal_title: 'Hospital Price Index',
    browser_portal_heading: 'Onslow Memorial Hospital',
    browser_portal_last_update: '2026-04-28',
    browser_portal_download_url: fileUrl,
    file_url: fileUrl, file_http_status: file.status,
    file_content_type: file.headers['content-type'], file_content_range: file.headers['content-range'],
    file_sha256: digest, retained_bytes: file.body.length,
    retained_sample: path.relative(root, sample).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Retain the exact pointer-to-HTML-to-CSV chain; recheck the pointer and linked CSV after a publisher change.'
  };
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, disposition: record.disposition, retained_bytes: record.retained_bytes }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
