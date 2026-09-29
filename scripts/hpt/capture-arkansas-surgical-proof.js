'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://arksurgicalhospital.com/cms-hpt.txt';
const pageUrl = 'https://arksurgicalhospital.com/patient-resources/';
const sourcePageUrl = 'https://clariti-health.com/csp/clariti/QuotableService.csp?orgKey=9534EB';
const fileUrl = 'https://clariti-health.com/csp/clariti/machinereadable/v2/710858717_Arkansas-Surgical-Hospital-LLC_standardcharges.csv';

function capturePointer() {
  const raw = cp.execFileSync('curl.exe', ['--location', '--silent', '--show-error', '--max-time', '25',
    '--max-filesize', '65536', '--write-out', '\n%{http_code}\n%{url_effective}', pointerUrl],
  { maxBuffer: 70000 });
  const suffix = Buffer.from('\n200\nhttps://arksurgicalhospital.com/wp-content/uploads/2026/01/cms-hpt-1.txt');
  if (!raw.subarray(-suffix.length).equals(suffix)) throw new Error('Unexpected pointer status or redirect');
  const body = raw.subarray(0, -suffix.length);
  return { status: 200, finalUrl: suffix.toString().split('\n')[2], body,
    sha256: crypto.createHash('sha256').update(body).digest('hex') };
}

async function main() {
  const pointer = capturePointer();
  const file = await retrieve(fileUrl, 262144, { timeoutMs: 30000 });
  const pointerText = pointer.body.toString('utf8');
  const header = (await parsePayload(file.body, 'text/csv')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (![200, 206].includes(pointer.status)
      || pointer.finalUrl !== 'https://arksurgicalhospital.com/wp-content/uploads/2026/01/cms-hpt-1.txt'
      || !pointerText.includes('location-name: Arkansas Surgical Hospital, LLC')
      || !pointerText.includes(`source-page-url: ${sourcePageUrl}`)
      || !pointerText.includes(`mrf-url: ${fileUrl}`)
      || file.status !== 200 || file.body.length !== 262144
      || !header || header.mrfHospitalName !== 'Arkansas Surgical Hospital, LLC'
      || header.mrfLocationName !== 'Arkansas Surgical Hospital, LLC'
      || header.mrfAddress !== '5201 Northshore Drive,,North Little Rock,AR,72118'
      || header.mrfLicenseState !== 'AR'
      || header.declaredLastUpdated !== '2026-03-13'
      || header.cmsVersion !== '3.0.0') {
    throw new Error('Current Arkansas Surgical pointer/page/file proof changed');
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '040147', official_domain: 'arksurgicalhospital.com',
    previous_vendor_domain: 'clariti-health.com',
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_final_url: pointer.finalUrl, pointer_sha256: pointer.sha256,
    official_page_url: pageUrl,
    official_page_observation: 'Search browser rendered the hospital patient-resources page with the vendor price-transparency link and 5201 Northshore Drive, North Little Rock address; the direct bounded client received a JavaScript redirect challenge, so no page byte hash is claimed.',
    source_page_url: sourcePageUrl,
    mrf_url: fileUrl, mrf_http_status: file.status,
    mrf_content_length: Number(file.headers['content-length']),
    mrf_sample_sha256: file.sha256, retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated,
    version: header.cmsVersion,
    observed_at: new Date().toISOString(),
    next_action: 'The root pointer and bounded header identify this hospital. Separately verify that the publisher source page exposes the exact CSV, and use a streaming full-file audit before making a whole-file validity or legal-compliance claim.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-arkansas-surgical-proof.json'),
    `${JSON.stringify({ record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, pointer: pointer.status,
    file: file.status, sample_sha256: file.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
