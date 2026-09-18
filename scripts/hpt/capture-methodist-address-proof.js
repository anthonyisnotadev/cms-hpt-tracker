'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '240053';
const pointerUrl = 'https://www.healthpartners.com/cms-hpt.txt';
const facilityUrl = 'https://www.healthpartners.com/care/hospitals/methodist';
const sourceUrl = 'https://www.healthpartners.com/care/hospitals/methodist/patient-guest/patient-information/financial-support/';
const mrfUrl = 'https://www.healthpartners.com/content/dam/brand-identity/pdfs/care/410832080_MethodistHospital_StandardCharges.csv';

async function main() {
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'))).find(row => row.ccn === ccn);
  const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'))).records.find(row => row.ccn === ccn);
  if (roster?.name !== 'PARK NICOLLET METHODIST HOSPITAL' || roster.address !== '6500 EXCELSIOR BLVD'
      || roster.state !== 'MN' || roster.zip !== '55426'
      || nationwide?.disposition !== 'pointer-facility-match-unresolved')
    throw new Error('Methodist roster or unresolved baseline changed');
  const [pointer, facility, source, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(facilityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(sourceUrl, 262144, { timeoutMs: 30000 }),
    retrieve(mrfUrl, 262144, { timeoutMs: 45000 }),
  ]);
  const raw = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/healthpartners.com-02cef7388d09.txt'));
  const block = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/).find(text =>
    text.split(/\r?\n/).some(line => line.trim() === 'location-name: Methodist Hospital'));
  const facilityText = cheerio.load(facility.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $source = cheerio.load(source.body.toString('utf8'));
  const sourceLinks = $source('a[href]').map((_, node) => new URL($source(node).attr('href'), sourceUrl).href).get();
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed.find(row => row.innerKind === 'csv');
  if (pointer.status !== 206 || !pointer.body.equals(raw)
      || pointer.sha256 !== '00bfadc0bc8d01fc00c894a60271a5f34b23db06fdaee6fe750801714d4c32a4'
      || ![200, 206].includes(facility.status) || ![200, 206].includes(source.status)
      || file.status !== 206 || file.body.length !== 262144
      || !block?.includes(`mrf-url: ${mrfUrl}`) || !sourceLinks.includes(mrfUrl)
      || !facilityText.includes('Methodist Hospital') || !facilityText.includes('6500 Excelsior Blvd.')
      || !facilityText.includes('55426')
      || parsed?.mrfHospitalName !== 'Methodist Hospital' || parsed.mrfLocationName !== 'Methodist Hospital'
      || parsed.mrfAddress !== '6500 Exclesior Blvd, St. Louis Park, MN 55426-4702'
      || parsed.mrfLicenseState !== 'MN' || parsed.declaredLastUpdated !== '2026-03-31'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error(`Methodist first-party page/pointer/file changed: ${JSON.stringify({pointerStatus:pointer.status,facilityStatus:facility.status,sourceStatus:source.status,fileStatus:file.status,sourceLink:sourceLinks.includes(mrfUrl),parsed})}`);
  const retained = `cms_data/hpt/nationwide-verification/file-byte-proof/${file.sha256}.bin`;
  fs.writeFileSync(path.join(root, retained), file.body);
  const proof = { ccn, roster_name: roster.name, roster_address: roster.address,
    former_name_source_url: 'https://www.healthpartners.com/institute/wp-content/uploads/2020/01/PN-MH-2020-Pharm-Res-BROCHURE-1.2020-New.Link_.pdf',
    former_name_web_reader_observation: 'HealthPartners 2020 residency brochure calls the 6500 Excelsior Blvd institution Park Nicollet Methodist Hospital.',
    facility_page_url: facilityUrl, facility_page_sha256: facility.sha256,
    source_page_url: sourceUrl, source_page_sha256: source.sha256,
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_observed_at: pointer.checkedAt,
    pointer_entry_without_contacts: block.split(/\r?\n/).filter(line => /^(location-name|source-page-url|mrf-url):/.test(line)),
    mrf_url: mrfUrl, mrf_http_status: file.status,
    file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_sample: retained, retained_bytes: file.body.length, retained_sha256: file.sha256,
    declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    observed_at: file.checkedAt,
    limitation: 'Current first-party campus, source page, root pointer and CSV header identify the same Methodist hospital; the declared street literal Exclesior conflicts with the independently verified Excelsior spelling. The bounded prefix does not establish complete-file validity or legal noncompliance.' };
  fs.writeFileSync(path.join(audit, 'reconciliation-methodist-address-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, retained_sha256: file.sha256 }));
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
