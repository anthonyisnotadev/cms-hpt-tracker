'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://www.tgh.org/cms-hpt.txt';
const pageUrl = 'https://www.tghnorth.org/patients-visitors/billing-insurance/pricing-information';
const facilities = [
  {
    ccn: '100071', name: 'Tampa General Hospital Brooksville', street: '17240 Cortez Blvd',
    city: 'Brooksville', zip: '34601',
    identityUrl: 'https://www.tghnorth.org/locations/tampa-general-hospital-brooksville',
    oldUrl: 'https://www.tghnorth.org/-/media/files/tgh-north-files/933040761_tampa-general-hospital-brooksville_standardcharges_excel.csv?rev=3e4c475cf0c946f28c90b4c5e6173db8&hash=09854218AE8DB2F1ECDAB2A90969CC06',
    currentUrl: 'https://www.tghnorth.org/-/media/files/tgh-north-files/933040761_tampa-general-hospital-brooksville_standardcharges.csv?rev=66ede8b1358246378c9569f8a1851232&hash=A12A7C1D9A8FCB8BA58899EF7B45B73D',
  },
  {
    ccn: '100249', name: 'Tampa General Hospital Crystal River', street: '6201 N Suncoast Blvd',
    city: 'Crystal River', zip: '34428',
    identityUrl: 'https://www.tghnorth.org/locations/tampa-general-hospital-crystal-river',
    oldUrl: 'https://www.tghnorth.org/-/media/files/tgh-north-files/93-3085834_tampa-general-hospital-crystal-river_standardcharges_excel.csv?rev=707784c8944a446c94601457bea65319&hash=A8E4902F0337A7A83FB17BF07844A443',
    currentUrl: 'https://www.tghnorth.org/-/media/files/tgh-north-files/93-3085834_tampa-general-hospital-crystal-river_standardcharges.csv?rev=27286936bd9f4061ba1fc0020af4fd39&hash=3E6AF7507886CB6B06DF627095C4D56B',
  },
];

async function capture(f, pointer, page) {
  const [identity, oldFile, currentFile] = await Promise.all([
    retrieve(f.identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(f.oldUrl, 65536, { timeoutMs: 30000, curlOnStatuses: [403, 404] }),
    retrieve(f.currentUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const pageText = page.body.toString('utf8');
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const $ = cheerio.load(pageText);
  const links = $('a[href]').map((_, a) => {
    try { return new URL($(a).attr('href'), pageUrl).href; } catch { return ''; }
  }).get().filter(url => url === f.currentUrl);
  const header = (await parsePayload(currentFile.body, currentFile.headers['content-type'] || 'text/csv')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (identity.status !== 200 || oldFile.status !== 404 || currentFile.status !== 206
      || currentFile.body.length !== 262144 || links.length !== 1
      || !pointerText.includes(`location-name: ${f.name}`)
      || !pointerText.includes(`mrf-url: ${f.oldUrl}`)
      || !identityText.includes(f.street) || !identityText.includes(f.city) || !identityText.includes(f.zip)
      || header?.mrfHospitalName !== f.name || !header.mrfLocationName.includes(f.name)
      || !header.mrfAddress.includes(f.street) || !header.mrfAddress.includes(f.zip)
      || header.mrfLicenseState !== 'FL' || header.declaredLastUpdated !== '2026-04-01'
      || header.cmsVersion !== '3.0.0') throw new Error(`TGH North proof changed for ${f.ccn}`);
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${currentFile.sha256}.bin`);
  fs.writeFileSync(samplePath, currentFile.body);
  return {
    ccn: f.ccn, official_domain: 'tgh.org', identity_url: f.identityUrl,
    identity_sha256: identity.sha256, source_page_url: pageUrl, source_page_sha256: page.sha256,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_mrf_url: f.oldUrl, pointer_mrf_http_status: oldFile.status,
    current_mrf_url: f.currentUrl, current_mrf_http_status: currentFile.status,
    current_mrf_sha256: currentFile.sha256, retained_bytes: currentFile.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: currentFile.checkedAt,
    next_action: `Recheck the exact ${f.name} root-pointer target after a publisher update; retain the separate first-party page-linked CSV and verify its full-file structure independently.`,
  };
}

async function main() {
  const [pointer, page] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
  ]);
  if (pointer.status !== 200 || page.status !== 200) throw new Error('TGH root pointer or pricing page unavailable');
  const records = await Promise.all(facilities.map(f => capture(f, pointer, page)));
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-tgh-north-pointer-mismatch-proofs.json'),
    JSON.stringify({ disposition: 'pointer-target-404-current-page-file', records }, null, 2) + '\n');
  console.log(JSON.stringify(records.map(row => ({ ccn: row.ccn, pointer_target_status: row.pointer_mrf_http_status,
    current_file_status: row.current_mrf_http_status, sample_sha256: row.current_mrf_sha256 }))));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
