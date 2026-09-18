'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://burgesshc.org/cms-hpt.txt';
const pageUrl = 'https://www.burgesshc.org/new-patients/price-transparency/';
const identityUrl = 'https://www.burgesshc.org/locations/burgess-health-center/';
const pointerFileUrl = 'https://www.burgesshc.org/wp-content/uploads/2025/01/420859940_Burgess_StandardCharges.csv';
const pageFileUrl = 'https://burgesshc.b-cdn.net/wp-content/uploads/2026/07/420859940_Burgess-Health-Center_StandardCharges.csv';

async function main() {
  const [pointer, page, identity, pointerFile, pageFile] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerFileUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageFileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const identityText = identity.body.toString('utf8').toLowerCase();
  const $ = cheerio.load(page.body.toString('utf8'));
  const links = $('a').map((_, a) => $(a).attr('href')).get().filter(href => href === pageFileUrl);
  const header = (await parsePayload(pageFile.body, pageFile.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (pointer.status !== 206 || page.status !== 200 || identity.status !== 200
      || pointerFile.status !== 404 || pageFile.status !== 206 || pageFile.body.length !== 262144
      || !pointerText.includes('location-name: Burgess Health Center')
      || !pointerText.includes(`mrf-url: ${pointerFileUrl}`) || links.length !== 1
      || !identityText.includes('burgess health center') || !identityText.includes('1600 diamond street')
      || !header || header.mrfHospitalName !== 'Burgess Health Center'
      || header.mrfLocationName !== 'Burgess Health Center'
      || header.mrfAddress !== '1600 Diamond Street, Onawa, IA 51040-1548'
      || header.mrfLicenseState !== 'IA' || header.declaredLastUpdated !== '2026-03-31'
      || header.cmsVersion !== '3.0.0') throw new Error('Burgess pointer, page, identity or file evidence changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${pageFile.sha256}.bin`);
  fs.writeFileSync(samplePath, pageFile.body);
  const record = {
    ccn: '161359', official_domain: 'burgesshc.org', official_identity_url: identityUrl,
    official_identity_sha256: identity.sha256, source_page_url: pageUrl, source_page_sha256: page.sha256,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_mrf_url: pointerFileUrl, pointer_mrf_http_status: pointerFile.status,
    pointer_mrf_sha256: pointerFile.sha256, current_mrf_url: pageFileUrl,
    current_mrf_http_status: pageFile.status, current_mrf_sha256: pageFile.sha256,
    retained_bytes: pageFile.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion, observed_at: pageFile.checkedAt,
    next_action: 'Retain the first-party page-linked CSV and its identity/metadata. Recheck the exact stale pointer-declared URL after a publisher change; do not call the current page file pointer-linked or infer a compliance verdict.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-burgess-pointer-mismatch-proof.json'),
    `${JSON.stringify({ disposition: 'pointer-target-404-current-page-file', record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, pointer_target: record.pointer_mrf_http_status,
    current_file: record.current_mrf_http_status, sample_sha256: record.current_mrf_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
