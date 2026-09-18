'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '230230';
const pointerUrl = 'https://uofmhealthsparrow.org/cms-hpt.txt';
const priceUrl = 'https://www.uofmhealthsparrow.org/patient-resources/financial-resources/standard-charges';
const facilityUrl = 'https://www.uofmhealthsparrow.org/our-hospitals-services/um-health-sparrow-hospitals/lansing';
const renameUrl = 'https://www.uofmhealthsparrow.org/news/marking-new-era-university-michigan-health-sparrow';
const mrfUrl = 'https://www.uofmhealthsparrow.org/sites/default/files/2026-03/um-health-sparrow-lansing-machine-readable-file-03-31-2026.csv';
const otherUrl = 'https://www.uofmhealthsparrow.org/sites/default/files/2026-03/um-health-sparrow-st-lawrence-machine-readable-file-03-31-2026.csv';

async function main() {
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'))).find(row => row.ccn === ccn);
  const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'))).records.find(row => row.ccn === ccn);
  const priorProof = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-sparrow-state-conflicts.json')));
  if (roster?.name !== 'EDWARD W SPARROW HOSPITAL' || roster.address !== '1215 E MICHIGAN AVENUE'
      || roster.state !== 'MI' || roster.zip !== '48912'
      || nationwide?.disposition !== 'pointer-facility-match-unresolved')
    throw new Error('Lansing roster or unresolved baseline changed');
  const [price, facility, rename, file] = await Promise.all([
    retrieve(priceUrl, 262144, { timeoutMs: 30000 }),
    retrieve(facilityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(renameUrl, 262144, { timeoutMs: 30000 }),
    retrieve(mrfUrl, 262144, { timeoutMs: 45000 }),
  ]);
  const pointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/uofmhealthsparrow.org-2e87ccdc4596.txt'));
  const pointerText = pointer.toString('utf8');
  const lansingBlock = pointerText.split(/\r?\n\s*\r?\n/).find(block => block.includes('location-name: University of Michigan Health-Sparrow Lansing'));
  const stLawrenceBlock = pointerText.split(/\r?\n\s*\r?\n/).find(block => block.includes('location-name: University of Michigan Health-Sparrow St. Lawrence'));
  const facilityText = cheerio.load(facility.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const renameText = cheerio.load(rename.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $price = cheerio.load(price.body.toString('utf8'));
  const pageLinks = $price('a[href]').map((_, node) => new URL($price(node).attr('href'), priceUrl).href).get();
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed.find(row => row.innerKind === 'csv');
  if (![200, 206].includes(price.status) || ![200, 206].includes(facility.status) || ![200, 206].includes(rename.status)
      || file.status !== 206 || file.body.length !== 262144
      || priorProof.pointer_sha256 !== '84324065af2b59be2d901a4d5709efd06a19a0b67b1c8e475ee438339689c43b'
      || !pageLinks.includes(mrfUrl)
      || !lansingBlock?.includes(`mrf-url: ${mrfUrl}`) || !stLawrenceBlock?.includes(`mrf-url: ${otherUrl}`)
      || !facilityText.includes('1215 E Michigan Avenue') || !facilityText.includes('48912')
      || !renameText.includes('Sparrow Hospital in Lansing has become University of Michigan Health-Sparrow Lansing')
      || parsed?.mrfHospitalName !== 'University of Michigan Health-Sparrow Lansing'
      || parsed.mrfLocationName !== 'University of Michigan Health-Sparrow Lansing|University of Michigan Health-St. Lawrence'
      || parsed.mrfAddress !== '1215 E Michigan Ave, Lansing, MI 48912|1210 W Saginaw St, Lansing, MI 48915'
      || parsed.mrfLicenseState !== 'CA' || parsed.declaredLastUpdated !== '2026-04-01'
      || parsed.cmsVersion !== '4.2')
    throw new Error(`Lansing pointer, first-party rename/campus or header changed: ${JSON.stringify({facilityStatus:facility.status,renameStatus:rename.status,fileStatus:file.status,parsed})}`);
  const retained = `cms_data/hpt/nationwide-verification/file-byte-proof/${file.sha256}.bin`;
  fs.writeFileSync(path.join(root, retained), file.body);
  const proof = { ccn, roster_name: roster.name, roster_address: roster.address, roster_state: roster.state,
    pointer_url: pointerUrl, pointer_sha256: priorProof.pointer_sha256, pointer_source: 'retained-raw-and-current-four-campus-recheck',
    source_page_url: priceUrl, source_page_sha256: price.sha256,
    facility_page_url: facilityUrl, facility_page_sha256: facility.sha256,
    rename_page_url: renameUrl, rename_page_sha256: rename.sha256,
    mrf_url: mrfUrl, separate_st_lawrence_pointer_mrf_url: otherUrl,
    mrf_http_status: file.status, file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_sample: retained, retained_bytes: file.body.length, retained_sha256: file.sha256,
    declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: 'MI', declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    observed_at: file.checkedAt,
    limitation: 'The pointer names a Lansing CSV separately from St. Lawrence. The Lansing CSV prefix lists both locations, but this CCN is anchored to the exact Lansing campus; no St. Lawrence CCN or file assignment is inferred. Its CA license-state field and literal 4.2 version require publisher review. The prefix is not complete-file validation or a legal verdict.' };
  fs.writeFileSync(path.join(audit, 'reconciliation-sparrow-lansing-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, retained_sha256: file.sha256, bytes: file.body.length }));
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
