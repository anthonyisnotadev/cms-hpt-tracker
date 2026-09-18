'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { csvToObjects } = require('./lib/util');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '294015';
const pointerUrl = 'https://renobehavioral.com/cms-hpt.txt';
const contactUrl = 'https://www.renobehavioral.com/contact';
const sourceUrl = 'https://www.renobehavioral.com/resources';
const fileUrl = 'https://www.renobehavioral.com/sites/default/files/reno/CMS%20Machine%20Readable%20HOS%208.2026.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (!roster || roster['Facility Name'] !== 'RENO BEHAVIORAL HEALTHCARE HOSPITAL, LLC'
      || roster.Address !== '6940 SIERRA CENTER PKWY' || roster['City/Town'] !== 'RENO'
      || roster.State !== 'NV' || roster['ZIP Code'] !== '89511'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.domain !== 'renobehavioral.com' || base.pointer_url !== pointerUrl)
    throw new Error('Reno roster or base assessment changed');
  const [pointer, contact, source, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(contactUrl, 65536, { timeoutMs: 30000 }),
    retrieve(sourceUrl, 65536, { timeoutMs: 30000 }),
    retrieve(fileUrl, 65536, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const pointerLocations = pointerText.split(/\r?\n/).filter(line => line.startsWith('location-name: '))
    .map(line => line.slice('location-name: '.length));
  const contactText = cheerio.load(contact.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const $ = cheerio.load(source.body.toString('utf8'));
  const sourceHref = $('a[href]').toArray().map(node => new URL($(node).attr('href'), sourceUrl).href)
    .find(href => href === fileUrl);
  const header = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  const rows = csvToObjects(file.body.toString('utf8'));
  if (pointer.status !== 206 || pointer.body.length !== 3192
      || pointerLocations.length !== 10 || pointerLocations.some(name => /Reno/i.test(name))
      || pointerText.includes(fileUrl)
      || contact.status !== 200 || !contactText.includes('Reno Behavioral Healthcare Hospital')
      || !contactText.includes('6940 Sierra Center Parkway') || !contactText.includes('Reno, NV 89511')
      || source.status !== 200 || sourceHref !== fileUrl
      || file.status !== 206 || file.body.length !== 15465
      || (file.headers['content-range'] || '') !== 'bytes 0-15464/15465'
      || rows.length !== 60
      || header?.mrfHospitalName !== 'Reno Behavioral healthcare Hospital, LLC'
      || header.mrfLocationName !== 'Reno Behavioral healthcare Hospital'
      || header.mrfAddress !== '6940 Sierra Center Parkway, Reno, NV 89511-2209'
      || header.mrfLicenseState !== 'NV' || header.declaredLastUpdated !== '2026-08-25'
      || header.cmsVersion !== '3.0.0')
    throw new Error('Reno root, page, campus or complete file changed: ' + JSON.stringify({
      pointerStatus: pointer.status, pointerBytes: pointer.body.length, pointerLocations,
      contactStatus: contact.status, sourceStatus: source.status, sourceHref,
      fileStatus: file.status, fileBytes: file.body.length,
      contentRange: file.headers['content-range'], rows: rows.length, header,
    }));
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    official_domain: 'renobehavioral.com', contact_url: contactUrl, contact_sha256: contact.sha256,
    source_page_url: sourceUrl, source_page_sha256: source.sha256,
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, pointer_bytes: pointer.body.length,
    pointer_location_names: pointerLocations, pointer_lists_reno: false,
    pointer_lists_page_file: false,
    page_mrf_url: fileUrl, page_mrf_http_status: file.status,
    page_mrf_sha256: file.sha256, page_mrf_bytes: file.body.length,
    page_mrf_total_bytes: 15465, page_mrf_parsed_rows: rows.length,
    retained_file: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress,
    declared_license_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Ask the publisher to add the Reno campus and its exact current CSV to the root cms-hpt.txt. After a pointer update, recheck the exact entry and full file; the complete download and header observation do not by themselves establish full-schema validity or legal compliance.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-reno-pointer-omission-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_lists_reno: false, file_bytes: file.body.length,
    file_sha256: file.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
