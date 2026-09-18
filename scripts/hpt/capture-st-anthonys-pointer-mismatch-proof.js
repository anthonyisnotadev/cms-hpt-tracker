'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload, zipEntries } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pageUrl = 'https://baycare.org/billing-and-insurance';
const identityUrl = 'https://baycare.org/locations/hospitals/st-anthonys-hospital/patients-and-visitors';
const pointerUrl = 'https://baycare.org/cms-hpt.txt';
const oldFileUrl = 'https://baycare.org/-/media/project/baycare/consumer-portal/billing-and-insurance/pricing-files-compressed/592043026_StAnthonysHospital_standardcharges.zip';
const currentFileUrl = 'https://baycare.org/-/media/project/baycare/consumer-portal/billing-and-insurance/pricing-files-compressed/592043026stanthonyshospitalstandardcharges.zip';

async function main() {
  const [pointer, page, identity, oldFile, currentFile] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(oldFileUrl, 65536, { timeoutMs: 30000, curlOnStatuses: [403, 404] }),
    retrieve(currentFileUrl, 8000000, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const $ = cheerio.load(page.body.toString('utf8'));
  const matchingLinks = $('a[href]').filter((_, a) => /St\.\s*Anthony.s Hospital/i.test($(a).text()))
    .map((_, a) => {
      try { return new URL($(a).attr('href'), pageUrl).href; } catch { return ''; }
    }).get().filter(url => url === currentFileUrl);
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const parsed = await parsePayload(currentFile.body, currentFile.headers['content-type'] || '', 262144);
  const header = parsed.parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  const members = zipEntries(currentFile.body).filter(item => /\.csv$/i.test(item.name));
  if (![200, 206].includes(pointer.status) || page.status !== 200 || identity.status !== 200
      || oldFile.status !== 404 || ![200, 206].includes(currentFile.status)
      || currentFile.body.length !== 7259344 || matchingLinks.length !== 1
      || !pointerText.includes("location-name: St Anthony's Hospital")
      || !pointerText.includes(`mrf-url: ${oldFileUrl}`)
      || !/1200 Seventh Ave\.? N\.?/i.test(identityText)
      || members.length !== 1 || header?.member !== members[0].name
      || header.mrfHospitalName !== "St Anthony's Hospital"
      || header.mrfLocationName !== "St Anthony's Hospital"
      || header.mrfAddress !== '1200 7th Avenue St. Petersburg FL 33705'
      || header.mrfLicenseState !== 'FL' || header.declaredLastUpdated !== '2026-01-01'
      || header.cmsVersion !== '3.0.0') throw new Error("St. Anthony's pointer/page/archive proof changed");
  const archiveDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, `${currentFile.sha256}.zip`);
  fs.writeFileSync(archivePath, currentFile.body);
  const proof = {
    ccn: '100067', official_domain: 'baycare.org', source_page_url: pageUrl,
    source_page_sha256: page.sha256, official_identity_url: identityUrl,
    official_identity_sha256: identity.sha256, pointer_url: pointerUrl,
    pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_mrf_url: oldFileUrl, pointer_mrf_http_status: oldFile.status,
    pointer_mrf_final_url: oldFile.finalUrl || '',
    current_mrf_url: currentFileUrl, current_mrf_http_status: currentFile.status,
    current_archive_sha256: currentFile.sha256, current_archive_bytes: currentFile.body.length,
    retained_archive: path.relative(root, archivePath).replaceAll('\\', '/'),
    archive_csv_member: header.member, bounded_inflated_bytes: parsed.inflatedBytes,
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    address_note: "The CSV omits the north direction in '1200 7th Avenue'; the first-party facility page and CMS roster identify 1200 Seventh Ave. N. at the same hospital, city and ZIP.",
    observed_at: currentFile.checkedAt,
    next_action: "After BayCare updates the St. Anthony's root pointer, verify the exact page-linked ZIP target and its CSV member. Keep the omitted street direction explicit and do not infer whole-file validity from bounded metadata.",
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-st-anthonys-pointer-mismatch-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: proof.ccn, pointer_target_status: proof.pointer_mrf_http_status,
    current_file_status: proof.current_mrf_http_status, archive_sha256: proof.current_archive_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
