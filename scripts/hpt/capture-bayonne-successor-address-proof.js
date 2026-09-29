'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { csvToObjects } = require('./lib/util');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '310025';
const pointerUrl = 'https://hudsonregionalhospital.com/cms-hpt.txt';
const legacyPointerUrl = 'https://carepointhealth.org/cms-hpt.txt';
const identityUrl = 'https://www.hudsonregionalhospital.com/contact/';
const pricingUrl = 'https://www.hudsonregionalhospital.com/hospital-charges/';
const fileUrl = 'https://images.pricetransparency.healthcare/hudson_regional_health_bayonne/261442063_bayonne-university-hospital_standardcharges.csv';
const pageFileUrl = 'https://www.hudsonregionalhospital.com/wp-content/uploads/2026/08/261442063_bayonne-university-hospital_standardcharges-2026.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (!roster || roster['Facility Name'] !== 'CAREPOINT HEALTH - BAYONNE MEDICAL CENTER'
      || roster.Address !== '29 EAST 29TH ST' || roster['City/Town'] !== 'BAYONNE'
      || roster.State !== 'NJ' || roster['ZIP Code'] !== '07002'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.domain !== 'carepointhealth.org' || base.pointer_url !== legacyPointerUrl)
    throw new Error('Bayonne roster or base assessment changed');
  const [pointer, legacyPointer, identity, pricing, file, pageFile] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(legacyPointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(identityUrl, 1048576, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 1048576, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pageFileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const blocks = pointerText.split(/\r?\n\s*\r?\n/);
  const bayonneBlock = blocks.find(block => /^location-name: Bayonne University Hospital\s*$/m.test(block));
  const fields = Object.fromEntries((bayonneBlock || '').split(/\r?\n/).map(line => {
    const at = line.indexOf(': ');
    return at < 0 ? [] : [line.slice(0, at), line.slice(at + 2).trim()];
  }).filter(pair => pair.length === 2));
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const $ = cheerio.load(pricing.body.toString('utf8'));
  const pricingLinks = $('a[href]').toArray().map(node => new URL($(node).attr('href'), pricingUrl).href);
  const header = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (![200, 206].includes(pointer.status) || pointer.body.length !== 1367
      || ![200, 206].includes(legacyPointer.status) || legacyPointer.sha256 !== pointer.sha256
      || fields['location-name'] !== 'Bayonne University Hospital' || fields['mrf-url'] !== fileUrl
      || identity.status !== 200 || !identityText.includes('Bayonne University Hospital')
      || !identityText.includes('29 E 29th Street') || !identityText.includes('Bayonne, NJ 07002')
      || pricing.status !== 200 || !pricingLinks.includes(pageFileUrl)
      || file.status !== 206 || file.body.length !== 262144
      || file.headers['content-range'] !== 'bytes 0-262143/286152286'
      || pageFile.status !== 206 || pageFile.body.length !== 262144
      || pageFile.headers['content-range'] !== 'bytes 0-262143/286152286'
      || pageFile.sha256 !== file.sha256
      || header?.mrfHospitalName !== 'Bayonne University Hospital'
      || header.mrfLocationName !== 'Bayonne University Hospital'
      || header.mrfAddress !== '29th Street & Avenue E, Bayonne, NJ 07002'
      || header.mrfLicenseState !== 'NJ' || header.declaredLastUpdated !== '2026-08-17'
      || header.cmsVersion !== '3.0.0')
    throw new Error('Bayonne publisher, pointer, file, or header changed: ' + JSON.stringify({
      pointerStatus: pointer.status, pointerBytes: pointer.body.length,
      pointerEntry: { location: fields['location-name'], mrf: fields['mrf-url'] },
      legacyHashAgrees: legacyPointer.sha256 === pointer.sha256,
      identityStatus: identity.status, identityAddress: identityText.includes('29 E 29th Street'),
      pricingStatus: pricing.status, pageLinksFile: pricingLinks.includes(pageFileUrl),
      fileStatus: file.status, fileBytes: file.body.length, range: file.headers['content-range'], header,
    }));
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    official_domain: 'hudsonregionalhospital.com', identity_page_url: identityUrl,
    identity_page_sha256: identity.sha256, identity_page_address: '29 E 29th Street, Bayonne, NJ 07002',
    pricing_page_url: pricingUrl, pricing_page_sha256: pricing.sha256,
    pricing_page_file_url: pageFileUrl, pricing_page_links_file: true,
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_bytes: pointer.body.length,
    legacy_pointer_url: legacyPointerUrl, legacy_pointer_sha256: legacyPointer.sha256,
    pointer_location_name: fields['location-name'], pointer_mrf_url: fields['mrf-url'],
    file_http_status: file.status, file_sample_sha256: file.sha256,
    file_sample_bytes: file.body.length, file_total_bytes: 286152286,
    page_file_http_status: pageFile.status, page_file_sample_sha256: pageFile.sha256,
    page_file_sample_bytes: pageFile.body.length, page_file_total_bytes: 286152286,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_license_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Confirm the publisher-intended relationship between the intersection-style file address (29th Street & Avenue E) and the numbered 29 E 29th Street campus; retain both literals. Then validate the complete 286,152,286-byte file and recheck on a publisher change. Do not interpret the bounded header as a full-schema or legal compliance verdict.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-bayonne-successor-address-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, sample_sha256: file.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
