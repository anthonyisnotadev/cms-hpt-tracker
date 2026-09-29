'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://www.bullockcountyhospital.com/cms-hpt.txt';
const pageUrl = 'https://www.bullockcountyhospital.com/general-4';
const fileUrl = 'https://ce2ea91a-ba41-4498-ab16-2bae48bc8556.usrfiles.com/ugd/ce2ea9_229d2d077ea74cf6a45992ffbb655715.csv';

async function main() {
  const [pointer, page, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 1048576, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const $ = cheerio.load(page.body.toString('utf8'));
  const bodyText = $('body').text().replace(/\s+/g, ' ');
  const pageFileLinks = $('a[href]').map((_, a) => $(a).attr('href')).get()
    .filter(href => href && new URL(href, pageUrl).pathname.endsWith('/ce2ea9_229d2d077ea74cf6a45992ffbb655715.csv'));
  const header = (await parsePayload(file.body, file.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (![200, 206].includes(pointer.status)
      || !String(pointer.headers['content-type']).startsWith('text/plain')
      || !pointerText.includes('location-name: Bullock County Rural Emergency Hospital')
      || !pointerText.includes(`mrf-url: ${fileUrl}`)
      || page.status !== 200 || !bodyText.includes('first Rural Emergency Hospital')
      || !bodyText.includes('May 1, 2024') || !bodyText.includes('102 Conecuh Ave W')
      || pageFileLinks.length < 1 || file.status !== 206 || file.body.length !== 262144
      || !header || header.mrfHospitalName !== 'Bullock County Hospital'
      || header.mrfAddress !== '102 Conecuh Avenue West, Union Springs, AL 36089'
      || header.mrfLicenseState !== 'CA' || header.declaredLastUpdated !== '2024-11-24'
      || header.cmsVersion !== '2.0.0') {
    throw new Error('Bullock current pointer/page/file transition evidence changed; review before recording');
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn_current_rural_emergency_hospital: '010779',
    ccn_earlier_acute_care_hospital: '010110',
    source_page_url: pageUrl, source_page_status: page.status,
    source_page_sha256_bounded: page.sha256, source_page_retained_bytes: page.body.length,
    source_page_transition_date: '2024-05-01',
    pointer_url: pointerUrl, pointer_final_url: pointer.finalUrl,
    pointer_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_location_name: 'Bullock County Rural Emergency Hospital',
    pointer_mrf_url: fileUrl, page_linked_same_file_path: true,
    file_status: file.status, file_sample_sha256: file.sha256,
    file_retained_bytes: file.body.length,
    file_retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress,
    declared_license_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated,
    declared_cms_version: header.cmsVersion,
    observed_at: file.checkedAt,
    disposition: 'current-reh-pointer-file-identity-with-explicit-license-state-conflict',
    next_action: 'Resolve the CSV license_number|CA declaration against the Alabama facility with publisher or corrected file evidence. Keep current REH CCN 010779 distinct from historical acute-care CCN 010110; do not infer the current file applies to both CCNs or promote either finding while the state conflict remains.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-bullock-reh-transition-proof.json'),
    `${JSON.stringify({ record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccns: ['010110', '010779'], status: file.status,
    sample_sha256: file.sha256, license_state_conflict: true }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
