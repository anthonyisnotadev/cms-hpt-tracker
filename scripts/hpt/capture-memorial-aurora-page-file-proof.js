'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { csvToObjects } = require('./lib/util');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '281320';
const officialDomain = 'memorialcommunityhealth.org';
const identityUrl = 'https://memorialcommunityhealth.org/resources/visitors/locations/';
const pointerUrl = 'https://memorialcommunityhealth.org/cms-hpt.txt';
const sourceUrl = 'https://search.hospitalpriceindex.com/hpi2/machineReadable/MemorialCommunityHealth/7911';
const pointerFileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7911/470461859_memorial-community-health-inc_standardcharges.csv';
const pageFileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7911/470461859_memorial-community-health%2C-inc_standardcharges.csv';
const browserObservedAt = '2026-09-17T06:36:21.000Z';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  const wrongPointerPath = path.join(root, 'cms_data/hpt/pointer-corpus/raw/upmc.com-77d089e8d6e1.txt');
  const wrongPointer = fs.readFileSync(wrongPointerPath);
  if (!roster || roster['Facility Name'] !== 'MEMORIAL HOSPITAL'
      || roster.Address !== '1423 SEVENTH ST' || roster['City/Town'] !== 'AURORA'
      || roster.State !== 'NE' || roster['ZIP Code'] !== '68818'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.domain !== 'upmc.com' || base.pointer_url !== 'https://upmc.com/cms-hpt.txt'
      || /Aurora|Nebraska|Memorial Hospital/i.test(wrongPointer.toString('utf8')))
    throw new Error('Aurora roster or prior UPMC assignment changed');

  const [identity, pointer, source, pointerFile, pageFile] = await Promise.all([
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(sourceUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pointerFileUrl, 65536, { timeoutMs: 30000, curlOnStatuses: [403, 404] }),
    retrieve(pageFileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const pointerText = pointer.body.toString('utf8');
  const parsed = await parsePayload(pageFile.body, pageFile.headers['content-type'] || 'text/csv');
  const header = parsed.parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (identity.status !== 200 || !identityText.includes('Memorial Hospital')
      || !/1423\s+7\s*th\s+Street/i.test(identityText) || !identityText.includes('Aurora')
      || !identityText.includes('68818')
      || ![200, 206].includes(pointer.status)
      || pointer.finalUrl !== 'https://search.hospitalpriceindex.com/7911/cms-hpt.txt'
      || !pointerText.includes('location-name: Memorial Hospital')
      || !pointerText.includes(`source-page-url: ${sourceUrl}`)
      || !pointerText.includes(`mrf-url: ${pointerFileUrl}`)
      || ![200, 206].includes(source.status) || pointerFile.status !== 404
      || pageFile.status !== 206 || pageFile.body.length !== 262144
      || header?.mrfHospitalName !== 'Memorial Community Health, Inc'
      || header.mrfLocationName !== 'Memorial Hospital'
      || header.mrfAddress !== '1423 7th St, Aurora, NE 68818'
      || header.mrfLicenseState !== 'NE' || header.declaredLastUpdated !== '2026-05-14'
      || header.cmsVersion !== '3.0.0')
    throw new Error('Aurora first-party pointer, page file, or header changed: ' + JSON.stringify({
      identityStatus: identity.status, identityName: identityText.includes('Memorial Hospital'),
      identityAddress: /1423\s+7\s*th\s+Street/i.test(identityText),
      pointerStatus: pointer.status, pointerFinal: pointer.finalUrl,
      pointerName: pointerText.includes('location-name: Memorial Hospital'),
      pointerSource: pointerText.includes(`source-page-url: ${sourceUrl}`),
      pointerFile: pointerText.includes(`mrf-url: ${pointerFileUrl}`),
      sourceStatus: source.status, pointerFileStatus: pointerFile.status,
      pageFileStatus: pageFile.status, pageFileBytes: pageFile.body.length,
      header: header && { name: header.mrfHospitalName, location: header.mrfLocationName,
        address: header.mrfAddress, state: header.mrfLicenseState,
        date: header.declaredLastUpdated, version: header.cmsVersion },
    }));

  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${pageFile.sha256}.bin`);
  fs.writeFileSync(samplePath, pageFile.body);
  const nextAction = 'After the publisher updates the Aurora root pointer, verify its exact MRF URL and readable bytes. Until then, keep the working pricing-page CSV separate from the pointer-linked 404 target; validate the full CSV structure independently.';
  const proof = {
    ccn, official_domain: officialDomain, roster_name: roster['Facility Name'],
    roster_address: roster.Address, roster_city: roster['City/Town'], roster_state: roster.State,
    roster_zip: roster['ZIP Code'], wrong_assigned_domain: base.domain,
    wrong_pointer_artifact: path.relative(root, wrongPointerPath).replaceAll('\\', '/'),
    wrong_pointer_sha256: sha(wrongPointer), identity_url: identityUrl,
    identity_sha256: identity.sha256, pointer_url: pointerUrl,
    pointer_final_url: pointer.finalUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, pointer_mrf_url: pointerFileUrl,
    pointer_mrf_http_status: pointerFile.status, pointer_mrf_response_sha256: pointerFile.sha256,
    source_page_url: sourceUrl, source_page_shell_http_status: source.status,
    source_page_shell_sha256: source.sha256,
    rendered_source_heading: 'Memorial Community Health',
    rendered_source_update: '2026-05-14', rendered_source_download_url: pageFileUrl,
    rendered_source_observed_at: browserObservedAt,
    current_mrf_url: pageFileUrl, current_mrf_http_status: pageFile.status,
    current_mrf_sha256: pageFile.sha256, retained_bytes: pageFile.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: pageFile.checkedAt, next_action: nextAction,
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-memorial-aurora-page-file-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_status: pointer.status, pointer_file_status: pointerFile.status,
    page_file_status: pageFile.status, file_sha256: pageFile.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
