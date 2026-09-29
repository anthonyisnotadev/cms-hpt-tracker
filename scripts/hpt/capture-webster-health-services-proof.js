'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'data/hpt-audit/reconciliation-webster-health-services-proof.json');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const pageUrl = 'https://www.nmhs.net/Patients-and-Visitors/Pricing/Price-Transparency';
const identityUrl = 'https://www.nmhs.net/locations/north-mississippi-medical-center-eupora';
const pointerUrl = 'https://www.nmhs.net/cms-hpt.txt';
const fileUrl = 'https://apps.nmhs.net/files/pt_mrf/640819193_webster-health-services,-inc-_standardcharges.json';
const pointerFileUrl = 'https://apps.nmhs.net/files/pt_mrf/640819193_webster-health-services-inc_standardcharges.json';

(async () => {
  fs.mkdirSync(sampleDir, { recursive: true });
  const [page, identity, pointer, pointerFile, file] = await Promise.all([
    retrieve(pageUrl, 524288, { timeoutMs: 30000 }),
    retrieve(identityUrl, 524288, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerFileUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 1048576, { timeoutMs: 30000 }),
  ]);
  const pageText = page.body.toString('utf8');
  const identityText = identity.body.toString('utf8');
  const pointerText = pointer.body.toString('utf8');
  if (page.status < 200 || page.status >= 300 || !pageText.includes(fileUrl)
      || !/Webster Health Services/i.test(pageText)) throw new Error('Webster official pricing page changed');
  if (identity.status < 200 || identity.status >= 300 || !/Webster Health Services, Inc\. DBA North Mississippi Medical Center-Eupora/i.test(identityText)
      || !/70 Medical Plaza/i.test(identityText)) throw new Error('Webster current facility identity page changed');
  if (pointer.status < 200 || pointer.status >= 300 || !pointerText.includes('location-name: Webster Health Services, Inc.')
      || !pointerText.includes(`mrf-url: ${pointerFileUrl}`)) throw new Error('Webster pointer entry changed');
  if (pointerFile.status !== 404) throw new Error('Webster pointer-declared file result changed');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed.find(item => item.mrfHospitalName && item.mrfAddress && item.mrfLicenseState);
  if (file.status < 200 || file.status >= 300 || !header || header.cmsVersion !== '3.0.0'
      || header.declaredLastUpdated !== '2026-04-01' || header.mrfLicenseState !== 'MS'
      || !/Webster Health Services/i.test(header.mrfHospitalName)
      || !/70 Medical Plaza, Eupora, MS 39744/i.test(header.mrfAddress)) {
    throw new Error('Webster file proof incomplete');
  }
  const totalBytes = Number((file.headers['content-range'] || '').split('/')[1]) || null;
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '250020', disposition: 'current-official-page-file-pointer-declared-file-unavailable', official_domain: 'nmhs.net',
    official_page_url: pageUrl, official_page_sha256: page.sha256,
    identity_page_url: identityUrl, identity_page_sha256: identity.sha256,
    pointer_url: pointerUrl, pointer_final_url: pointer.finalUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, pointer_location_name: 'Webster Health Services, Inc.',
    pointer_mrf_url: pointerFileUrl, pointer_mrf_http_status: pointerFile.status,
    pointer_mrf_sha256: pointerFile.sha256, current_mrf_url: fileUrl, current_mrf_final_url: file.finalUrl,
    current_mrf_http_status: file.status, current_mrf_sha256: file.sha256,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    total_file_bytes: totalBytes, declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName, declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState, declared_date: header.declaredLastUpdated,
    version: header.cmsVersion, observed_at: file.checkedAt,
    next_action: 'Retain the exact official-page file and metadata without calling it pointer-linked. Recheck after the pointer or either file URL changes; the pointer-declared URL currently returns 404.',
  };
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
