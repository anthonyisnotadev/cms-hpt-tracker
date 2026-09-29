'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { csvToObjects } = require('./lib/util');
const { parsePointer } = require('./lib/parse');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://www.uvmhealth.org/cms-hpt.txt';
const historyUrl = 'https://www.uvmhealth.org/locations/university-of-vermont-medical-center/history';
const identityUrl = 'https://www.uvmhealth.org/locations/university-of-vermont-medical-center';
const pricingUrl = 'https://www.uvmhealth.org/patients-visitors/billing-insurance/price-transparency';
const fileUrl = 'https://www.uvmhealth.org/sites/default/files/030219309_university-of-vermont-medical-center-inc_standardcharges.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '470003');
  const base = csvToObjects(fs.readFileSync(path.join(root, 'data/hpt-audit/compliance.csv'), 'utf8'))
    .find(row => row.ccn === '470003');
  if (!roster || roster['Facility Name'] !== 'UNIV. OF VERMONT - FLETCHER ALLEN HEALTH CARE'
      || roster.Address !== '111 COLCHESTER AVE' || roster['City/Town'] !== 'BURLINGTON'
      || roster.State !== 'VT' || roster['ZIP Code'] !== '05401'
      || !base || base.finding !== 'not-assessed-domain-unknown')
    throw new Error('UVM Medical Center roster or base changed');
  const [pointer, history, identity, pricing, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(historyUrl, 262144, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const entries = parsePointer(pointer.body.toString('utf8')).entries;
  const entry = entries.find(item => item.locationName === 'University of Vermont Medical Center');
  const historyText = cheerio.load(history.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const $ = cheerio.load(pricing.body.toString('utf8'));
  const pricingLinks = $('a[href]').toArray().map(node => new URL($(node).attr('href'), pricingUrl).href);
  const header = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (pointer.status !== 206 || pointer.sha256 !== 'b9584a0bdb9b08b1a972d0c701d507c76f3bafa1591a59f1ab5e56998402e014'
      || pointer.body.length !== 1934 || entries.length !== 6 || entry?.mrfUrl !== fileUrl
      || history.status !== 200 || !historyText.includes('Fletcher Allen Health Care')
      || !historyText.includes('now known as University of Vermont Medical Center')
      || identity.status !== 200 || !identityText.includes('University of Vermont Medical Center')
      || !identityText.includes('111 Colchester') || !identityText.includes('Burlington')
      || pricing.status !== 200 || !pricingLinks.includes(fileUrl)
      || file.status !== 206 || file.body.length !== 262144
      || file.headers['content-range'] !== 'bytes 0-262143/273530788'
      || header?.mrfHospitalName !== 'University of Vermont Medical Center Inc'
      || !header.mrfLocationName.includes('University of Vermont Medical Center - Rehabilitation Unit')
      || !header.mrfAddress.includes('111 Colchester Avenue, Burlington, VT 05401')
      || !header.mrfAddress.includes('790 College Parkway, Colchester, VT 05446')
      || header.mrfLicenseState !== 'VT' || header.declaredLastUpdated !== '2026-04-28'
      || header.cmsVersion !== '3.0.0')
    throw new Error('UVM Medical Center first-party alias/pointer/header changed: ' + JSON.stringify({
      pointerStatus: pointer.status, pointerSha: pointer.sha256, entry: entry?.mrfUrl,
      historyStatus: history.status, historyAlias: historyText.includes('now known as University of Vermont Medical Center'),
      identityStatus: identity.status, identityAddress: identityText.includes('111 Colchester'),
      pricingStatus: pricing.status, pricingLink: pricingLinks.includes(fileUrl),
      fileStatus: file.status, fileRange: file.headers['content-range'], header,
    }));
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn: '470003', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_bytes: pointer.body.length,
    pointer_entry_count: entries.length, pointer_location_name: entry.locationName,
    identity_page_url: identityUrl, identity_page_sha256: identity.sha256,
    history_page_url: historyUrl, history_page_sha256: history.sha256,
    history_explicit_former_name: 'Fletcher Allen Health Care',
    pricing_page_url: pricingUrl, pricing_page_sha256: pricing.sha256,
    pricing_page_links_file: true, mrf_url: fileUrl, file_http_status: file.status,
    file_sample_sha256: file.sha256, file_sample_bytes: file.body.length,
    file_total_bytes: 273530788,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_names: header.mrfLocationName,
    declared_addresses: header.mrfAddress,
    declared_license_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Validate the full 273,530,788-byte CSV, including the separate rehabilitation location at 790 College Parkway. Recheck the exact root pointer entry and file header after a publisher change.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-uvm-medical-center-alias-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: proof.ccn, pointer_sha256: proof.pointer_sha256,
    file_sample_sha256: proof.file_sample_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
