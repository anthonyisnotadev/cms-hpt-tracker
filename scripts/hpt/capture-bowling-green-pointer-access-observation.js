'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '180013';
const pointerUrl = 'https://medcenterhealth.org/cms-hpt.txt';
const sourcePageUrl = 'https://medcenterhealth.org/price-transparency/';
const facilityPageUrl = 'https://medcenterhealth.org/location/the-medical-center-at-bowling-green/';
const portalUrl = 'https://medcenterhealth.org/charges/mcbg/';
const pageDownloadUrl = 'https://medcenterhealth.org/download/16252/';
const hostedFileUrl = 'https://d2fdxbmd3bwjx.cloudfront.net/610920842_The-Medical-Center_20260501.0.zip';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'THE MEDICAL CENTER (BOWLING GREEN)'
      || roster.Address !== '250 PARK STREET' || roster['City/Town'] !== 'BOWLING GREEN'
      || roster.State !== 'KY' || roster['ZIP Code'] !== '42101'
      || base?.finding !== 'not-assessed-not-named-in-file' || base.pointer_url !== pointerUrl)
    throw new Error('Bowling Green roster or previous assessment changed');
  const [pointer, portal, page, download, hosted] = await Promise.all([
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(portalUrl, 262144, { timeoutMs: 30000 }),
    retrieve(sourcePageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pageDownloadUrl, 262144, { timeoutMs: 30000 }),
    retrieve(hostedFileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes('location-name: The Medical Center\n')
      || block.startsWith('location-name: The Medical Center\r\n'));
  const safeEntry = entry?.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(hosted.body, hosted.headers['content-type'] || 'application/zip')).parsed
    .find(item => item.innerKind === 'json');
  if (pointer.status !== 200 || portal.status !== 403 || page.status !== 403
      || download.status !== 403 || ![pageDownloadUrl, portalUrl].includes(download.finalUrl)
      || !safeEntry?.includes('location-name: The Medical Center')
      || !safeEntry.includes(`source-page-url: ${sourcePageUrl}`)
      || !safeEntry.includes(`mrf-url: ${portalUrl}`)
      || hosted.status !== 206 || hosted.body.length !== 262144
      || parsed?.member !== '610920842_The-Medical-Center_standardcharges.json'
      || parsed.mrfHospitalName !== '610920842 - The Medical Center at Bowling Green'
      || parsed.mrfLocationName !== 'The Medical Center at Bowling Green'
      || parsed.mrfAddress !== '250 Park St. Bowling Green, KY 42101'
      || parsed.mrfLicenseState !== 'KY' || parsed.declaredLastUpdated !== '2026-04-01'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Bowling Green pointer, access outcome, or hosted ZIP metadata changed');
  const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.records.some(row => row.ccn === ccn)) throw new Error('Existing Bowling Green observation requires manual review');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${hosted.sha256}.bin`);
  fs.writeFileSync(samplePath, hosted.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    first_party_facility_page_url: facilityPageUrl,
    first_party_facility_page_web_reader_observation: 'The Medical Center at Bowling Green, 250 Park Street, Bowling Green KY 42101',
    source_page_url: sourcePageUrl, bounded_source_page_http_status: page.status,
    source_page_web_reader_observation: 'Separate Hospital Standard Charges link labeled The Medical Center at Bowling Green',
    source_page_download_url: pageDownloadUrl,
    source_page_web_reader_redirect_observation: hostedFileUrl,
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256,
    pointer_entry_without_contacts: safeEntry, pointer_target_url: portalUrl,
    pointer_target_bounded_http_status: portal.status,
    pointer_target_response_sha256: portal.sha256,
    source_page_download_bounded_http_status: download.status,
    source_page_download_bounded_final_url: download.finalUrl,
    hosted_file_url: hostedFileUrl, hosted_file_http_status: hosted.status,
    hosted_file_total_bytes: Number((hosted.headers['content-range'] || '').split('/')[1]) || null,
    retained_bytes: hosted.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: hosted.sha256, archive_member: parsed.member,
    declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    observed_at: hosted.checkedAt,
    limitation: 'The web reader exposed a hosted ZIP redirect from the current pricing-page download link, but the bounded client received 403 from both the pointer portal and page download route. Only the first 262144 bytes of the separate hosted ZIP were retained. An exact successful pointer-to-file request and full ZIP/member validation are still missing; no clean MRF promotion or legal verdict.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-bowling-green-pointer-access-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.records.push({ ccn, observed_at: hosted.checkedAt,
    proof_file: 'reconciliation-bowling-green-pointer-access-proof.json',
    facility_role: 'the-medical-center-at-bowling-green-exact-campus',
    official_pricing_page: sourcePageUrl, pointer_url: pointerUrl,
    pointer_target_url: portalUrl, pointer_target_bounded_http_status: portal.status,
    hosted_file_url: hostedFileUrl, hosted_file_sample_sha256: hosted.sha256,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    disposition: 'first-party-pointer-alias-and-hosted-page-file-identified-but-portal-access-unverified',
    next_action: 'Use a browser-capable download to verify the exact pointer portal and current pricing-page link resolve to the same complete file, then validate ZIP/member structure and declared facility metadata. The bounded client received 403; do not treat that as a facility failure or promote the separate hosted prefix as pointer-verified.' });
  ledger.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, hosted_sample_sha256: hosted.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
