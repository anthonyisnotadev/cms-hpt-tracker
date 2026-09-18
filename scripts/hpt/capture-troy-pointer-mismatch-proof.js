'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'data/hpt-audit/reconciliation-troy-pointer-mismatch-proof.json');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const sourcePageUrl = 'https://troymedicalcenter.com/patients-visitors/list-of-standard-charges-or-shoppable-services/';
const pointerUrl = 'https://troymedicalcenter.com/cms-hpt.txt';
const currentMrf = 'https://troymedicalcenter.com/wp-content/uploads/2026/03/271534178_Troy-Regional-Medical-Center_standardcharges.csv';
const staleMrf = 'https://www.troymedicalcenter.com/wp-content/uploads/2024/12/271534178_the-troy-hospital-health-care-authority_standardcharges-1.csv';
const sha256 = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
  fs.mkdirSync(sampleDir, { recursive: true });
  const [page, pointer, file] = await Promise.all([
    retrieve(sourcePageUrl, 524288, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(currentMrf, 262144, { timeoutMs: 30000 })
  ]);
  const pageText = page.body.toString('utf8'), pointerText = pointer.body.toString('utf8');
  if (page.status < 200 || page.status >= 300 || !pageText.includes(currentMrf)) throw new Error('Official Troy page does not link expected current MRF');
  if (pointer.status < 200 || pointer.status >= 300 || !pointerText.includes(staleMrf) || pointerText.includes(currentMrf))
    throw new Error('Troy pointer no longer has the documented stale/current mismatch');
  if (file.status < 200 || file.status >= 300 || file.body.length < 65536) throw new Error('Current Troy MRF retrieval failed');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed.find(p => p.cmsVersion && p.mrfHospitalName && p.mrfAddress && p.mrfLicenseState);
  if (!header || header.cmsVersion !== '3.0.0' || header.mrfLicenseState !== 'AL'
      || !/Troy Regional Medical Center/i.test(header.mrfHospitalName || '')
      || !/1330 .*231 South/i.test(header.mrfAddress || '')) throw new Error('Current Troy MRF metadata mismatch');
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '010126', disposition: 'official-page-current-mrf-root-pointer-still-links-stale-mrf',
    official_domain: 'troymedicalcenter.com', source_page_url: sourcePageUrl,
    source_page_http_status: page.status, source_page_sha256: sha256(page.body),
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: sha256(pointer.body),
    pointer_location_name: 'Troy Regional Medical Center', pointer_mrf_url: staleMrf,
    current_mrf_url: currentMrf, current_mrf_http_status: file.status, current_mrf_sha256: file.sha256,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Do not search for another Troy file or call the current file stale. Retain the official-page-linked current CMS 3.0.0 file as corroborated evidence, while recording that cms-hpt.txt still points to the older 2024 file; recheck the pointer for publisher correction.'
  };
  fs.writeFileSync(output, JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
