'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'data/hpt-audit/reconciliation-san-carlos-borromeo-proof.json');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const identityUrl = 'https://hscbmoca.org/';
const pointerUrl = 'https://hscbmoca.org/cms-hpt.txt';
const portalUrl = 'https://hscbmocaorg.ipage.com/prices/index.php';
const fileUrl = 'https://hscbmocaorg.ipage.com/prices/data/660371418_Hospital-San-Carlos-Inc.json';

(async () => {
  fs.mkdirSync(sampleDir, { recursive: true });
  const [identity, pointer, portal, file] = await Promise.all([
    retrieve(identityUrl, 524288, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(portalUrl, 524288, { timeoutMs: 30000 }),
    retrieve(fileUrl, 1048576, { timeoutMs: 30000 }),
  ]);
  const identityText = identity.body.toString('utf8');
  const pointerText = pointer.body.toString('utf8');
  const portalText = portal.body.toString('utf8');
  if (identity.status < 200 || identity.status >= 300 || !/Hospital San Carlos Borromeo/i.test(identityText)
      || !/550 Ave\. Concepci[oó]n Vera Ayala/i.test(identityText)) throw new Error('San Carlos identity page changed');
  if (pointer.status < 200 || pointer.status >= 300 || !pointerText.includes('location-name: Hospital San Carlos, Inc.')
      || !pointerText.includes(`mrf-url: ${portalUrl}`)) throw new Error('San Carlos pointer entry changed');
  if (portal.status < 200 || portal.status >= 300 || !portalText.includes('data/660371418_Hospital-San-Carlos-Inc.json')
      || !/Hospital San Carlos Borromeo/i.test(portalText)) throw new Error('San Carlos download portal changed');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed.find(item => item.mrfHospitalName && item.mrfAddress && item.mrfLicenseState);
  if (file.status < 200 || file.status >= 300 || !header || header.cmsVersion !== '2.0.0'
      || header.declaredLastUpdated !== '2025-02-19' || header.mrfLicenseState !== 'PR'
      || !/Hospital San Carlos, Inc/i.test(header.mrfHospitalName)
      || !/550 Concepcion Vera Ayala, Moca, PR 00676/i.test(header.mrfAddress)) {
    throw new Error('San Carlos file proof incomplete');
  }
  const totalBytes = Number((file.headers['content-range'] || '').split('/')[1]) || null;
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '400111', disposition: 'pointer-links-html-download-page-with-stale-v2-file',
    official_domain: 'hscbmoca.org', identity_page_url: identityUrl,
    identity_page_sha256: identity.sha256, pointer_url: pointerUrl,
    pointer_final_url: pointer.finalUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, pointer_location_name: 'Hospital San Carlos, Inc.',
    pointer_mrf_url: portalUrl, portal_http_status: portal.status, portal_sha256: portal.sha256,
    current_mrf_url: fileUrl, current_mrf_final_url: file.finalUrl,
    current_mrf_http_status: file.status, current_mrf_sha256: file.sha256,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    total_file_bytes: totalBytes, declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName, declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState, declared_date: header.declaredLastUpdated,
    version: header.cmsVersion, observed_at: file.checkedAt,
    next_action: 'Recheck after the root pointer, portal download link or file bytes change. Retain the exact stale CMS 2.0.0 file and the factual HTML-intermediary pointer defect without calling the file directly pointer-linked or current.',
  };
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
