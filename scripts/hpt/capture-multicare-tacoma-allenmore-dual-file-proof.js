'use strict';

const fs = require('fs');
const path = require('path');
const { csvToObjects } = require('./lib/util');
const { parsePointer } = require('./lib/parse');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://multicare.org/cms-hpt.txt';
const allenmoreUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8058/911352172-1366556227_tacoma-general-allenmore-hospital_standardcharges.csv';
const tacomaUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8062/911352172-1366556227_tacoma-general-allenmore-hospital_standardcharges.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '500129');
  const base = csvToObjects(fs.readFileSync(path.join(root, 'data/hpt-audit/compliance.csv'), 'utf8'))
    .find(row => row.ccn === '500129');
  if (!roster || roster['Facility Name'] !== 'TACOMA GENERAL ALLENMORE HOSPITAL'
      || roster.Address !== '315 S MLK JR WAY' || roster['City/Town'] !== 'TACOMA'
      || roster.State !== 'WA' || roster['ZIP Code'] !== '98405'
      || !base || base.finding !== 'compliant-observed' || base.mrf_url !== tacomaUrl)
    throw new Error('Tacoma/Allenmore roster or standing base changed');
  const [pointer, allenmore, tacoma] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(allenmoreUrl, 262144, { timeoutMs: 30000 }),
    retrieve(tacomaUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const entries = parsePointer(pointer.body.toString('utf8')).entries;
  const aEntry = entries.find(entry => entry.locationName === 'MultiCare Allenmore Hospital');
  const tEntry = entries.find(entry => entry.locationName === 'MultiCare Tacoma General Hospital');
  const aHeader = (await parsePayload(allenmore.body, allenmore.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  const tHeader = (await parsePayload(tacoma.body, tacoma.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (pointer.status !== 206 || pointer.body.length !== 7330
      || pointer.sha256 !== '7981ae2ab16b08e52b2e8eb1120a3176f1d751b3d780b2499318b00a55b7273e'
      || entries.length !== 19 || aEntry?.mrfUrl !== allenmoreUrl || tEntry?.mrfUrl !== tacomaUrl
      || allenmore.status !== 206 || allenmore.body.length !== 262144
      || allenmore.headers['content-range'] !== 'bytes 0-262143/1425037351'
      || tacoma.status !== 206 || tacoma.body.length !== 262144
      || tacoma.headers['content-range'] !== 'bytes 0-262143/1425037330'
      || aHeader?.mrfHospitalName !== 'Tacoma General Allenmore Hospital'
      || tHeader?.mrfHospitalName !== 'Tacoma General Allenmore Hospital'
      || !aHeader.mrfLocationName.includes('MulitCare Allenmore Hospital')
      || !tHeader.mrfLocationName.includes('MultiCare Allenmore Hospital')
      || !aHeader.mrfAddress.includes('315 Martin Luther King Jr. Way, Tacoma, WA 98405')
      || !tHeader.mrfAddress.includes('315 Martin Luther King Jr Way, Tacoma, WA 98405')
      || !aHeader.mrfAddress.includes('1901 South Union, Tacoma, WA 98405')
      || !tHeader.mrfAddress.includes('1901 South Union, Tacoma, WA 98405')
      || aHeader.mrfLicenseState !== 'WA' || tHeader.mrfLicenseState !== 'WA'
      || aHeader.declaredLastUpdated !== '2026-08-27' || tHeader.declaredLastUpdated !== '2026-08-27'
      || aHeader.cmsVersion !== '3.0.0' || tHeader.cmsVersion !== '3.0.0')
    throw new Error('MultiCare current pointer or bounded headers changed: ' + JSON.stringify({
      pointerStatus: pointer.status, pointerSha: pointer.sha256, entryCount: entries.length,
      allenmoreEntry: aEntry?.mrfUrl, tacomaEntry: tEntry?.mrfUrl,
      allenmoreStatus: allenmore.status, allenmoreRange: allenmore.headers['content-range'], allenmoreHeader: aHeader,
      tacomaStatus: tacoma.status, tacomaRange: tacoma.headers['content-range'], tacomaHeader: tHeader,
    }));
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  for (const result of [allenmore, tacoma])
    fs.writeFileSync(path.join(sampleDir, `${result.sha256}.bin`), result.body);
  const fileProof = (result, header, entry, totalBytes) => ({
    pointer_location_name: entry.locationName, pointer_source_page_url: entry.sourcePageUrl,
    mrf_url: entry.mrfUrl, http_status: result.status, sample_sha256: result.sha256,
    sample_bytes: result.body.length, total_bytes: totalBytes,
    retained_sample: path.relative(root, path.join(sampleDir, `${result.sha256}.bin`)).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_names: header.mrfLocationName,
    declared_addresses: header.mrfAddress, declared_license_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
  });
  const proof = {
    ccn: '500129', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256,
    pointer_bytes: pointer.body.length, pointer_entry_count: entries.length,
    allenmore: fileProof(allenmore, aHeader, aEntry, 1425037351),
    tacoma: fileProof(tacoma, tHeader, tEntry, 1425037330),
    observed_at: tacoma.checkedAt,
    next_action: 'Retain both current pointer-declared CSVs as distinct Tacoma General Allenmore campus files. Validate their full 1.4 GB contents and determine whether the Allenmore location-name typo affects downstream parsing; recheck both exact pointer entries after a publisher change.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-multicare-tacoma-allenmore-dual-file-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: proof.ccn, pointer_sha256: proof.pointer_sha256,
    allenmore_sample_sha256: proof.allenmore.sample_sha256, tacoma_sample_sha256: proof.tacoma.sample_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
