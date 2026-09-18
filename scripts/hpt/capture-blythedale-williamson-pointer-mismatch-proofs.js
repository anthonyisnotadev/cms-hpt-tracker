'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const facilities = [
  { ccn: '333301', domain: 'blythedale.org', pointerUrl: 'https://blythedale.org/cms-hpt.txt',
    pointerName: "Blythedale Children's Hospital",
    pointerFileUrl: 'https://www.blythedale.org/documents/13-1739922blythedale-childrens-hospitalstandardchargescsv',
    pageUrl: 'https://www.blythedale.org/price-transparency-shoppable-services',
    pageFileUrl: 'https://www.blythedale.org/documents/13-1739922blythedale-children-s-hospitalstandardcharges',
    pageIdentity: ['Blythedale Children', '95 Bradhurst Avenue', 'Valhalla, NY 10595'],
    name: "Blythedale Children's Hospital", address: '95 Bradhurst Ave., Valhalla, NY 10595',
    state: 'NY', date: '2026-03-01', bytes: 32927 },
  { ccn: '440029', domain: 'williamsonhealth.org', pointerUrl: 'https://williamsonhealth.org/cms-hpt.txt',
    pointerName: 'Williamson Medical Center',
    pointerFileUrl: 'https://williamsonhealth.org/content/uploads/2026/04/621501534_williamson-medical-center_standardcharges.csv',
    pageUrl: 'https://williamsonhealth.org/patients-and-visitors/patient-information/patient-financial-information/',
    pageFileUrl: 'http://williamsonhealth.org/content/uploads/2026/08/621501534_williamson-medical-center_standardcharges.csv',
    pageIdentity: ['Williamson Medical Center', '4321 Carothers Pkwy', 'Franklin, TN 37067'],
    name: 'Williamson County Hospital District', location: 'Williamson Medical Center',
    address: '4321 Carothers Pkwy, Franklin, TN 37067', state: 'TN', date: '2026-08-01', bytes: 262144 },
];

async function capture(f) {
  const [pointer, page, pointerFile, pageFile] = await Promise.all([
    retrieve(f.pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(f.pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(f.pointerFileUrl, 65536, { timeoutMs: 30000 }),
    retrieve(f.pageFileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const pageText = cheerio.load(page.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $ = cheerio.load(page.body.toString('utf8'));
  const links = $('a').map((_, a) => new URL($(a).attr('href') || '', f.pageUrl).href).get()
    .filter(url => url === f.pageFileUrl);
  const header = (await parsePayload(pageFile.body, pageFile.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (![200, 206].includes(pointer.status)
      || !String(pointer.headers['content-type']).startsWith('text/plain')
      || ![200, 206].includes(page.status)
      || pointerFile.status !== 404 || pageFile.status !== 206 || pageFile.body.length !== f.bytes
      || !pointerText.includes(`location-name: ${f.pointerName}`)
      || !pointerText.includes(`mrf-url: ${f.pointerFileUrl}`) || links.length !== 1
      || f.pageIdentity.some(item => !pageText.includes(item))
      || !header || header.mrfHospitalName !== f.name
      || header.mrfLocationName !== (f.location || f.name) || header.mrfAddress !== f.address
      || header.mrfLicenseState !== f.state || header.declaredLastUpdated !== f.date
      || header.cmsVersion !== '3.0.0') throw new Error(`Current Blythedale/Williamson proof changed for ${f.ccn}`);
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${pageFile.sha256}.bin`);
  fs.writeFileSync(samplePath, pageFile.body);
  return {
    ccn: f.ccn, official_domain: f.domain, source_page_url: f.pageUrl,
    source_page_sha256: page.sha256, pointer_url: f.pointerUrl,
    pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_mrf_url: f.pointerFileUrl, pointer_mrf_http_status: pointerFile.status,
    pointer_mrf_sha256: pointerFile.sha256,
    current_mrf_url: f.pageFileUrl, current_mrf_final_url: pageFile.finalUrl,
    current_mrf_http_status: pageFile.status, current_mrf_sha256: pageFile.sha256,
    retained_bytes: pageFile.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName, declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState, declared_date: header.declaredLastUpdated,
    version: header.cmsVersion, observed_at: pageFile.checkedAt,
    page_updated_claim: f.ccn === '333301' ? 'all files updated on 3/31/2026' : '',
    next_action: f.ccn === '333301'
      ? 'Recheck the exact 404 pointer target after a publisher change and reconcile the pricing-page 3/31/2026 update statement against the file-declared 2026-03-01 date; do not treat the page-linked file as pointer-linked.'
      : 'Recheck the exact 404 pointer target after a publisher change; retain the separately page-linked August CSV without calling it pointer-linked or inferring compliance.',
  };
}

async function main() {
  const records = await Promise.all(facilities.map(capture));
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-blythedale-williamson-pointer-mismatch-proofs.json'),
    `${JSON.stringify({ disposition: 'pointer-target-404-current-page-file', records }, null, 2)}\n`);
  console.log(JSON.stringify(records.map(row => ({ ccn: row.ccn, pointer_target: row.pointer_mrf_http_status,
    current_file: row.current_mrf_http_status, sample_sha256: row.current_mrf_sha256 }))));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
