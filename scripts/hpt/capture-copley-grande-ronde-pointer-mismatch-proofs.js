'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const facilities = [
  { ccn: '471305', domain: 'copleyvt.org', name: 'Copley Hospital', state: 'VT',
    address: '528 Washington Highway Morrisville, VT 05661', street: '528 Washington Highway',
    date: '2026-06-05', pointerUrl: 'https://www.copleyvt.org/cms-hpt.txt',
    pointerName: 'Copley Hospital',
    pageUrl: 'https://www.copleyvt.org/for-patients-and-visitors/billing-and-insurance/',
    pointerFileUrl: 'https://www.copleyvt.org/030179423_Copley-Hospital_standardcharges.csv',
    pageFileUrl: 'https://www.copleyvt.org/03-0179423_Copley-Hospital_standardcharges.csv',
    linkText: 'Charge Master: Machine Readable CDM', fileStatus: 206 },
  { ccn: '381321', domain: 'grh.org', name: 'Grande Ronde Hospital', state: 'OR',
    address: '900 Sunset Drive, La Grande, OR 97850', street: '900 Sunset Drive',
    date: '2026-03-31', pointerUrl: 'https://grh.org/cms-hpt.txt',
    pointerName: 'Grande Ronde Hospital and Clinics',
    pageUrl: 'https://www.grh.org/patients-visitors/price-transparency/',
    pointerFileUrl: 'https://www.grh.org/clientfiles/GetFile/930505325_grande-ronde-hospital_standardcharges.csv',
    pageFileUrl: 'https://www.grh.org/clientfiles/GetFile/08-2026_930505325_grande-ronde-hospital_standardcharges.csv',
    linkText: 'HERE', fileStatus: 200 },
];

async function capture(f) {
  const [pointer, page, pointerFile, pageFile] = await Promise.all([
    retrieve(f.pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(f.pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(f.pointerFileUrl, 65536, { timeoutMs: 30000 }),
    retrieve(f.pageFileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const pageText = page.body.toString('utf8');
  const $ = cheerio.load(pageText);
  const links = $('a').filter((_, a) => $(a).text().trim() === f.linkText)
    .map((_, a) => new URL($(a).attr('href'), f.pageUrl).href).get()
    .filter(url => url === f.pageFileUrl);
  const header = (await parsePayload(pageFile.body, pageFile.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (![200, 206].includes(pointer.status) || page.status !== 200 || pointerFile.status !== 404
      || pageFile.status !== f.fileStatus || pageFile.body.length !== 262144
      || !pointerText.includes(`location-name: ${f.pointerName}`)
      || !pointerText.includes(`mrf-url: ${f.pointerFileUrl}`) || links.length !== 1
      || !pageText.includes(f.street) || !header || header.mrfHospitalName !== f.name
      || header.mrfLocationName !== f.name || header.mrfAddress !== f.address
      || header.mrfLicenseState !== f.state || header.declaredLastUpdated !== f.date
      || header.cmsVersion !== '3.0.0') throw new Error(`Current pointer/page/file proof changed for ${f.ccn}`);
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${pageFile.sha256}.bin`);
  fs.writeFileSync(samplePath, pageFile.body);
  return {
    ccn: f.ccn, official_domain: f.domain, source_page_url: f.pageUrl,
    source_page_sha256: page.sha256, pointer_url: f.pointerUrl,
    pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_mrf_url: f.pointerFileUrl, pointer_mrf_http_status: pointerFile.status,
    pointer_mrf_sha256: pointerFile.sha256, current_mrf_url: f.pageFileUrl,
    current_mrf_http_status: pageFile.status, current_mrf_sha256: pageFile.sha256,
    retained_bytes: pageFile.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName, declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState, declared_date: header.declaredLastUpdated,
    version: header.cmsVersion, observed_at: pageFile.checkedAt,
    next_action: 'Retain the first-party page-linked CSV and its identity/metadata. Recheck the exact stale pointer-declared URL after a publisher change; do not call the current page file pointer-linked or infer a compliance verdict.',
  };
}

async function main() {
  const records = await Promise.all(facilities.map(capture));
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-copley-grande-ronde-pointer-mismatch-proofs.json'),
    `${JSON.stringify({ disposition: 'pointer-target-404-current-page-file', records }, null, 2)}\n`);
  console.log(JSON.stringify(records.map(row => ({ ccn: row.ccn, pointer_target: row.pointer_mrf_http_status,
    current_file: row.current_mrf_http_status, sample_sha256: row.current_mrf_sha256 }))));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
