'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { csvToObjects } = require('./lib/util');
const { parsePointer } = require('./lib/parse');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '330184';
const pointerUrl = 'https://montefiorenewrochelle.org/cms-hpt.txt';
const identityUrl = 'https://montefiorenewrochelle.org/contact-us';
const sourceUrl = 'https://montefiorenewrochelle.org/patients-and-visitors/paying-for-your-care';
const pointerFileUrl = 'https://assets.montefioreeinstein.org/patient-information/462931956_new-rochelle-hospital_standardcharges.csv';
const pageFileUrl = 'https://asset-storage-prod.s3.us-east-1.amazonaws.com/patient-information/492931956_new-rochelle-hospital_standardcharges.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (!roster || roster['Facility Name'] !== 'MONTEFIORE NEW ROCHELLE HOSPITAL'
      || roster.Address !== '16 GUION PLACE' || roster['City/Town'] !== 'NEW ROCHELLE'
      || roster.State !== 'NY' || roster['ZIP Code'] !== '10802'
      || !base || base.finding !== 'not-assessed-domain-unknown')
    throw new Error('Montefiore New Rochelle roster or base assessment changed');
  const [pointer, identity, source, pointerFile, pageFile] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(sourceUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerFileUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pageFileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const parsed = parsePointer(pointerText);
  const pointerEntry = parsed.entries.find(entry => entry.locationName === 'Montefiore New Rochelle');
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const $ = cheerio.load(source.body.toString('utf8'));
  const sourceText = $.text().replace(/\s+/g, ' ');
  const links = $('a[href]').toArray().map(node => new URL($(node).attr('href'), sourceUrl).href);
  const pointerHeader = (await parsePayload(pointerFile.body, pointerFile.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  const pageHeader = (await parsePayload(pageFile.body, pageFile.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (![200, 206].includes(pointer.status) || pointer.body.length !== 363
      || Buffer.from(pointerText).filter(byte => byte === 13).length !== 48
      || pointerText.includes('\n') || parsed.entries.length !== 1
      || pointerEntry?.mrfUrl !== pointerFileUrl
      || pointerEntry?.sourcePageUrl !== sourceUrl
      || identity.status !== 200 || !identityText.includes('Montefiore New Rochelle Hospital')
      || !identityText.includes('16 Guion Place') || !identityText.includes('New Rochelle, NY 10801')
      || source.status !== 200 || !links.includes(pageFileUrl)
      || !sourceText.includes('file last updated 4/01/26')
      || pointerFile.status !== 206 || pointerFile.body.length !== 262144
      || pointerFile.headers['content-range'] !== 'bytes 0-262143/166983064'
      || pageFile.status !== 206 || pageFile.body.length !== 262144
      || pageFile.headers['content-range'] !== 'bytes 0-262143/299963990'
      || pointerHeader?.mrfHospitalName !== 'Montefiore New Rochelle Hospital'
      || pointerHeader.mrfLocationName !== 'Montefiore New Rochelle Hospital'
      || pointerHeader.mrfAddress !== '16 Guion Place, New Rochelle, NY 10801'
      || pointerHeader.mrfLicenseState !== 'NY'
      || pointerHeader.declaredLastUpdated !== '2025-06-27' || pointerHeader.cmsVersion !== '2.0.0'
      || pageHeader?.mrfHospitalName !== 'Montefiore New Rochelle Hospital'
      || pageHeader.mrfLocationName !== 'Montefiore New Rochelle Hospital'
      || pageHeader.mrfAddress !== '16 Guion Place, New Rochelle, NY 10801'
      || pageHeader.mrfLicenseState !== 'NY'
      || pageHeader.declaredLastUpdated !== '2026-04-01' || pageHeader.cmsVersion !== '3.0.0')
    throw new Error('Montefiore pointer/page file role changed: ' + JSON.stringify({
      pointerStatus: pointer.status, pointerBytes: pointer.body.length,
      parsedEntries: parsed.entries.length, pointerUrl: pointerEntry?.mrfUrl,
      identityStatus: identity.status, identityAddress: identityText.includes('16 Guion Place'),
      sourceStatus: source.status, pageLink: links.includes(pageFileUrl),
      pointerFileStatus: pointerFile.status, pointerRange: pointerFile.headers['content-range'], pointerHeader,
      pageFileStatus: pageFile.status, pageRange: pageFile.headers['content-range'], pageHeader,
    }));
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  for (const result of [pointerFile, pageFile])
    fs.writeFileSync(path.join(sampleDir, `${result.sha256}.bin`), result.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    identity_page_url: identityUrl, identity_page_sha256: identity.sha256,
    identity_page_address: '16 Guion Place, New Rochelle, NY 10801',
    source_page_url: sourceUrl, source_page_sha256: source.sha256,
    source_page_declared_update: '4/01/26', source_page_links_page_file: true,
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256,
    pointer_bytes: pointer.body.length, pointer_line_endings: 'CR-only',
    pointer_location_name: pointerEntry.locationName,
    pointer_mrf_url: pointerFileUrl, pointer_file_http_status: pointerFile.status,
    pointer_file_sample_sha256: pointerFile.sha256,
    pointer_file_sample_bytes: pointerFile.body.length, pointer_file_total_bytes: 166983064,
    pointer_file_retained_sample: path.relative(root, path.join(sampleDir, `${pointerFile.sha256}.bin`)).replaceAll('\\', '/'),
    pointer_file_declared_name: pointerHeader.mrfHospitalName,
    pointer_file_declared_address: pointerHeader.mrfAddress,
    pointer_file_declared_state: pointerHeader.mrfLicenseState,
    pointer_file_date: pointerHeader.declaredLastUpdated,
    pointer_file_version: pointerHeader.cmsVersion,
    page_mrf_url: pageFileUrl, page_file_http_status: pageFile.status,
    page_file_sample_sha256: pageFile.sha256,
    page_file_sample_bytes: pageFile.body.length, page_file_total_bytes: 299963990,
    page_file_retained_sample: path.relative(root, path.join(sampleDir, `${pageFile.sha256}.bin`)).replaceAll('\\', '/'),
    page_file_declared_name: pageHeader.mrfHospitalName,
    page_file_declared_address: pageHeader.mrfAddress,
    page_file_declared_state: pageHeader.mrfLicenseState,
    page_file_date: pageHeader.declaredLastUpdated,
    page_file_version: pageHeader.cmsVersion,
    observed_at: pageFile.checkedAt,
    next_action: 'Ask the publisher to update the root cms-hpt.txt to the current page-linked 2026-04-01/version-3.0.0 CSV, then verify the exact new pointer entry. Preserve the roster ZIP 10802 versus both file headers and the current first-party contact page ZIP 10801 as a separate address discrepancy. Validate the full page file before any clean-file or legal compliance conclusion.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-montefiore-new-rochelle-pointer-page-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256,
    pointer_file_sha256: pointerFile.sha256, page_file_sha256: pageFile.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
