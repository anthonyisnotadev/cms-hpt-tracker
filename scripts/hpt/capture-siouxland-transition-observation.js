'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '160153';
const pressUrl = 'https://www.unitypoint.org/news-and-articles/press-releases/unitypoint-health-acquires-mercyone-siouxland-medical-center';
const facilityUrl = 'https://www.unitypoint.org/locations/unitypoint-health---st-lukes---downtown';
const directoryUrl = 'https://dia-hfd.iowa.gov/Home/PublicEntityDetails?recordid=477';
const pointerUrl = 'https://unitypoint.org/cms-hpt.txt';
const fileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7954/421019872_northwest-iowa-hospital-corporation_standardcharges.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'));
  const old = roster.find(row => row['Facility ID'] === ccn);
  const parent = roster.find(row => row['Facility ID'] === '160146');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (old?.['Facility Name'] !== 'MERCYONE SIOUXLAND MEDICAL CENTER'
      || old.Address !== '801 5TH ST' || old.State !== 'IA' || old['ZIP Code'] !== '51101'
      || parent?.['Facility Name'] !== 'ST LUKES REGIONAL MEDICAL CENTER'
      || parent.Address !== '2720 STONE PARK BOULEVARD'
      || base?.finding !== 'not-assessed-not-named-in-file')
    throw new Error('Siouxland roster or prior assessment changed');
  const [press, facility, directory, pointer, file] = await Promise.all([
    retrieve(pressUrl, 262144, { timeoutMs: 30000 }),
    retrieve(facilityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(directoryUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const text = result => cheerio.load(result.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const pointerEntries = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/);
  const downtown = pointerEntries.find(block => block.includes('location-name: UnityPoint Health - St. Lukes Downtown'));
  const regional = pointerEntries.find(block => block.includes("location-name: UnityPoint Health - St. Luke's Regional Medical Center"));
  const safeEntries = [downtown, regional].map(block => block?.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line)));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed
    .find(item => item.innerKind === 'csv');
  if ([press, facility, directory, pointer, file].some(result => ![200, 206].includes(result.status))
      || !text(press).includes('assumed ownership of MercyOne Siouxland Medical Center')
      || !text(press).includes('The new name is UnityPoint Health')
      || !text(facility).includes('801 5th Street')
      || !text(directory).includes("St Luke's Regional Medical Center Downtown")
      || !text(directory).includes('Former Entity Name:')
      || !text(directory).includes('MercyOne Siouxland Medical Center')
      || !text(directory).includes('160146')
      || !text(directory).includes('801 5th ST')
      || !safeEntries.every(lines => lines?.includes(`mrf-url: ${fileUrl}`))
      || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'Northwest Iowa Hospital Corporation'
      || !parsed.mrfLocationName.includes("UnityPoint Health - St. Luke's Downtown")
      || !parsed.mrfAddress.includes('801 15th St, Sioux City, IA 51101')
      || parsed.mrfLicenseState !== 'IA' || parsed.declaredLastUpdated !== '2026-01-28'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Siouxland ownership, state record, pointer, or file discrepancy changed');
  const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.records.some(row => row.ccn === ccn)) throw new Error('Existing Siouxland observation requires manual review');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: old['Facility Name'], roster_address: old.Address,
    parent_roster_ccn: '160146', parent_roster_name: parent['Facility Name'],
    first_party_acquisition_url: pressUrl, first_party_acquisition_sha256: press.sha256,
    first_party_downtown_url: facilityUrl, first_party_downtown_sha256: facility.sha256,
    state_directory_url: directoryUrl, state_directory_sha256: directory.sha256,
    state_directory_current_ccn: '160146', state_directory_former_name: old['Facility Name'],
    state_directory_address: '801 5th ST, Sioux City, IA 51101',
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_entries_without_contacts: safeEntries,
    shared_file_url: fileUrl, file_http_status: file.status,
    file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_names: parsed.mrfLocationName, declared_addresses: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, observed_at: file.checkedAt,
    limitation: 'The current state directory lists Downtown under 160146 and former name MercyOne Siouxland, but this does not independently prove when or whether 160153 terminated. The shared file declares 801 15th St, whereas the roster, state directory and first-party page say 801 5th St. Only 262,144 bytes of the file were retained. Do not assign the parent file to 160153 as a clean match.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-siouxland-transition-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.records.push({ ccn, observed_at: file.checkedAt,
    proof_file: 'reconciliation-siouxland-transition-proof.json',
    facility_role: 'historical-mercyone-siouxland-roster-ccn-after-unitypoint-acquisition',
    current_first_party_facility_url: facilityUrl,
    current_state_directory_url: directoryUrl,
    current_state_directory_ccn: '160146',
    old_roster_ccn: ccn,
    pointer_url: pointerUrl,
    current_parent_pointer_location: 'UnityPoint Health - St. Lukes Downtown',
    shared_file_sample_sha256: file.sha256,
    declared_downtown_address: '801 15th St, Sioux City, IA 51101',
    current_first_party_and_state_address: '801 5th St, Sioux City, IA 51101',
    disposition: 'acquired-renamed-downtown-listed-under-parent-ccn-with-current-file-address-conflict',
    next_action: 'Obtain authoritative dated CMS enrollment or certification evidence for whether/when 160153 terminated or merged into 160146. Ask UnityPoint to reconcile 801 15th versus 801 5th in the shared MRF. Keep 160153 unresolved; do not assign the 160146 parent file or infer a closure date from acquisition alone.' });
  ledger.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, current_directory_ccn: '160146', sample_sha256: file.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
