'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { csvToObjects } = require('./lib/util');
const { parsePointer } = require('./lib/parse');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://www.uvmhealth.org/cms-hpt.txt';
const identityUrl = 'https://www.uvmhealth.org/locations/alice-hyde-medical-center';
const pricingUrl = 'https://www.uvmhealth.org/patients-visitors/billing-insurance/price-transparency';
const aliceUrl = 'https://www.uvmhealth.org/sites/default/files/150346515_alice-hyde-medical-center_standardcharges.csv';
const champlainUrl = 'https://www.uvmhealth.org/sites/default/files/141338471_champlain-valley-physicians-hospital-medical-center_standardcharges.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'));
  const aliceRoster = roster.find(row => row['Facility ID'] === '331321');
  const champlainRoster = roster.find(row => row['Facility ID'] === '330250');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '331321');
  if (!aliceRoster || aliceRoster['Facility Name'] !== 'THE UNIVERSITY OF VERMONT HEALTH NETWORK-ALICE HY'
      || aliceRoster.Address !== '133 PARK STREET, PO BOX 729'
      || aliceRoster['City/Town'] !== 'MALONE' || aliceRoster.State !== 'NY'
      || aliceRoster['ZIP Code'] !== '12953'
      || !champlainRoster || champlainRoster['Facility Name'] !== 'THE UNIVERSITY OF VERMONT HEALTH NETWORK  - CHAMPL'
      || champlainRoster.Address !== '75 BEEKMAN STREET'
      || champlainRoster['City/Town'] !== 'PLATTSBURGH' || champlainRoster.State !== 'NY'
      || champlainRoster['ZIP Code'] !== '12901'
      || !base || base.finding !== 'not-assessed-domain-unknown')
    throw new Error('UVM Alice/Champlain roster or base assessment changed');
  const [pointer, identity, pricing, aliceFile, champlainFile] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(aliceUrl, 262144, { timeoutMs: 30000 }),
    retrieve(champlainUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const entries = parsePointer(pointer.body.toString('utf8')).entries;
  const aliceEntry = entries.find(entry => entry.locationName === 'Alice Hyde Medical Center');
  const champlainEntry = entries.find(entry => entry.locationName === 'Champlain Valley Physicians Hospital');
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const $ = cheerio.load(pricing.body.toString('utf8'));
  const pricingLinks = $('a[href]').toArray().map(node => new URL($(node).attr('href'), pricingUrl).href);
  const aliceHeader = (await parsePayload(aliceFile.body, aliceFile.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  const champlainHeader = (await parsePayload(champlainFile.body, champlainFile.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (pointer.status !== 206 || pointer.body.length !== 1934 || entries.length !== 6
      || aliceEntry?.mrfUrl !== aliceUrl || champlainEntry?.mrfUrl !== champlainUrl
      || identity.status !== 200 || !identityText.includes('Alice Hyde Medical Center')
      || !identityText.includes('133 Park Street') || !identityText.includes('Malone, NY 12953')
      || pricing.status !== 200 || !pricingLinks.includes(aliceUrl)
      || aliceFile.status !== 206 || aliceFile.body.length !== 262144
      || aliceFile.headers['content-range'] !== 'bytes 0-262143/53533454'
      || aliceHeader?.mrfHospitalName !== 'Alice Hyde Medical Center'
      || !aliceHeader.mrfLocationName.includes('Alice Hyde Medical Center')
      || !aliceHeader.mrfAddress.includes('133 Park Street, Malone, NY 12953')
      || aliceHeader.mrfLicenseState !== 'NY' || aliceHeader.declaredLastUpdated !== '2026-04-28'
      || aliceHeader.cmsVersion !== '3.0.0'
      || champlainFile.status !== 206 || champlainFile.body.length !== 262144
      || champlainFile.headers['content-range'] !== 'bytes 0-262143/168221255'
      || champlainHeader?.mrfHospitalName !== 'Champlain Valley Physicians Hospital Medical Center'
      || !champlainHeader.mrfAddress.includes('75 Beekman Street, Plattsburgh, NY 12901')
      || champlainHeader.mrfLicenseState !== 'NY' || champlainHeader.declaredLastUpdated !== '2026-04-28'
      || champlainHeader.cmsVersion !== '3.0.0')
    throw new Error('UVM pointer or separate Alice/Champlain headers changed: ' + JSON.stringify({
      pointerStatus: pointer.status, pointerBytes: pointer.body.length, entries: entries.length,
      aliceEntry: aliceEntry?.mrfUrl, champlainEntry: champlainEntry?.mrfUrl,
      identityStatus: identity.status, pricingStatus: pricing.status, aliceLink: pricingLinks.includes(aliceUrl),
      aliceFileStatus: aliceFile.status, aliceRange: aliceFile.headers['content-range'], aliceHeader,
      champlainFileStatus: champlainFile.status, champlainRange: champlainFile.headers['content-range'], champlainHeader,
    }));
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  for (const result of [aliceFile, champlainFile])
    fs.writeFileSync(path.join(sampleDir, `${result.sha256}.bin`), result.body);
  const proof = {
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256,
    pointer_bytes: pointer.body.length, pointer_entry_count: entries.length,
    identity_page_url: identityUrl, identity_page_sha256: identity.sha256,
    pricing_page_url: pricingUrl, pricing_page_sha256: pricing.sha256,
    pricing_page_links_alice_file: true,
    alice: {
      ccn: '331321', roster_name: aliceRoster['Facility Name'],
      roster_address: aliceRoster.Address, roster_city: aliceRoster['City/Town'],
      roster_state: aliceRoster.State, roster_zip: aliceRoster['ZIP Code'],
      pointer_location_name: aliceEntry.locationName, mrf_url: aliceUrl,
      file_http_status: aliceFile.status, file_sample_sha256: aliceFile.sha256,
      file_sample_bytes: aliceFile.body.length, file_total_bytes: 53533454,
      retained_sample: path.relative(root, path.join(sampleDir, `${aliceFile.sha256}.bin`)).replaceAll('\\', '/'),
      declared_hospital_name: aliceHeader.mrfHospitalName,
      declared_location_names: aliceHeader.mrfLocationName,
      declared_addresses: aliceHeader.mrfAddress,
      declared_license_state: aliceHeader.mrfLicenseState,
      declared_date: aliceHeader.declaredLastUpdated, version: aliceHeader.cmsVersion,
    },
    champlain: {
      ccn: '330250', roster_name: champlainRoster['Facility Name'],
      roster_address: champlainRoster.Address, roster_city: champlainRoster['City/Town'],
      roster_state: champlainRoster.State, roster_zip: champlainRoster['ZIP Code'],
      pointer_location_name: champlainEntry.locationName, mrf_url: champlainUrl,
      file_http_status: champlainFile.status, file_sample_sha256: champlainFile.sha256,
      file_sample_bytes: champlainFile.body.length, file_total_bytes: 168221255,
      retained_sample: path.relative(root, path.join(sampleDir, `${champlainFile.sha256}.bin`)).replaceAll('\\', '/'),
      declared_hospital_name: champlainHeader.mrfHospitalName,
      declared_addresses: champlainHeader.mrfAddress,
      declared_license_state: champlainHeader.mrfLicenseState,
      declared_date: champlainHeader.declaredLastUpdated, version: champlainHeader.cmsVersion,
    },
    observed_at: aliceFile.checkedAt,
    next_action: 'Validate Alice Hyde’s full 53,533,454-byte CSV, including the separately named swing-bed location. Keep Champlain Valley CCN 330250 only on its distinct 75 Beekman Street file under this shared root; do not copy one CCN to sibling pointer entries. Recheck exact entries and file headers after a publisher change.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-uvm-shared-pointer-attribution-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ alice_ccn: proof.alice.ccn, champlain_ccn: proof.champlain.ccn,
    pointer_sha256: pointer.sha256, alice_file_sha256: aliceFile.sha256,
    champlain_file_sha256: champlainFile.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
