'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '310010';
const pointerUrl = 'https://www.pennmedicine.org/cms-hpt.txt';
const fileUrl = 'https://tupa-q-001.sitecorecontenthub.cloud/api/public/content/210635009_penn-medicine-princeton-medical-center_standardcharges.csv';
const identityUrl = 'https://www.pennmedicine.org/locations/princeton-medical-center';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (!roster || roster['Facility Name'] !== 'UNIVERSITY MEDICAL CENTER OF PRINCETON AT PLAINSBORO'
      || roster.Address !== 'ONE-FIVE PLAINSBORO ROAD' || roster['City/Town'] !== 'PLAINSBORO'
      || roster.State !== 'NJ' || roster['ZIP Code'] !== '08536'
      || !base || base.finding !== 'not-assessed-domain-unknown')
    throw new Error('Princeton roster or base assessment changed');
  const [pointer, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(fileUrl, 65536, { timeoutMs: 30000 }),
  ]);
  const blocks = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/);
  const block = blocks.find(text => /^location-name: Penn Medicine Princeton Health\s*$/m.test(text));
  const fields = Object.fromEntries((block || '').split(/\r?\n/).map(line => {
    const at = line.indexOf(': ');
    return at < 0 ? [] : [line.slice(0, at), line.slice(at + 2).trim()];
  }).filter(pair => pair.length === 2));
  const header = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (pointer.status !== 200 || pointer.body.length !== 5501
      || fields['location-name'] !== 'Penn Medicine Princeton Health'
      || fields['mrf-url'] !== fileUrl
      || fields['source-page-url'] !== 'https://www.pennmedicine.org/patient-resources/policies/pricing-transparency'
      || file.status !== 206 || file.body.length !== 65536
      || file.headers['content-range'] !== 'bytes 0-65535/248501573'
      || header?.mrfHospitalName !== 'Penn Medicine Princeton Medical Center'
      || !header.mrfLocationName.includes('Penn Medicine Princeton Medical Center')
      || !header.mrfAddress.includes('1 Plainsboro Rd., Plainsboro, NJ 08536')
      || header.mrfLicenseState !== 'NJ' || header.declaredLastUpdated !== '2026-03-20'
      || header.cmsVersion !== '3.0.0')
    throw new Error('Princeton pointer, file, or header changed: ' + JSON.stringify({
      pointerStatus: pointer.status, pointerBytes: pointer.body.length,
      entry: { location: fields['location-name'], mrf: fields['mrf-url'] },
      fileStatus: file.status, fileBytes: file.body.length, range: file.headers['content-range'], header,
    }));
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    identity_page_url: identityUrl, identity_page_address: '1 Plainsboro Rd, Plainsboro Township, NJ 08536',
    identity_page_review: 'Current first-party page reviewed via web search; direct scripted retrieval returned a short access response, so no page-byte hash is asserted.',
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_bytes: pointer.body.length, pointer_location_name: fields['location-name'],
    pointer_source_page_url: fields['source-page-url'], pointer_mrf_url: fields['mrf-url'],
    mrf_http_status: file.status, mrf_sha256: file.sha256, sample_bytes: file.body.length,
    total_bytes: 248501573, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_names: header.mrfLocationName,
    declared_addresses: header.mrfAddress, declared_license_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Validate the full 248,501,573-byte CSV and confirm that its multi-location records appropriately distinguish Princeton Medical Center from the rehabilitation and behavioral-health locations. Recheck pointer and header when the publisher updates the file.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-princeton-pointer-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, sample_sha256: file.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
