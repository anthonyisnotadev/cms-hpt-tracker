'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { csvToObjects } = require('./lib/util');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '250099';
const identityUrl = 'https://www.umc.edu/Greenwood/About/Overview.html';
const pricingUrl = 'https://umc.edu/Healthcare/Patients-and-Visitors/Bill%20Pay/UMMC%20Pricing.html';
const pointerUrl = 'https://umc.edu/cms-hpt.txt';
const legacyPointerUrl = 'http://glh.org/cms-hpt.txt';
const vendorPageUrl = 'https://pricetransparency.accureg.net/greenwoodleflore';
const vendorBase = 'https://cdn.accureg.net/trans/greenwoodleflore/64-6000400_Greenwood-Leflore-Hospital_standardcharges';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (!roster || roster['Facility Name'] !== 'GREENWOOD LEFLORE HOSPITAL'
      || roster.Address !== '1401 RIVER RD' || roster['City/Town'] !== 'GREENWOOD'
      || roster.State !== 'MS' || roster['ZIP Code'] !== '38930'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.domain !== 'glh.org' || base.pointer_url !== pointerUrl)
    throw new Error('Greenwood roster or base assignment changed');
  const [identity, pricing, pointer, legacyPointer, vendor, csv, json] = await Promise.all([
    retrieve(identityUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(legacyPointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(vendorPageUrl, 65536, { timeoutMs: 30000 }),
    retrieve(`${vendorBase}.csv`, 262144, { timeoutMs: 30000 }),
    retrieve(`${vendorBase}.json`, 262144, { timeoutMs: 30000 }),
  ]);
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const pricingText = cheerio.load(pricing.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const pointerText = pointer.body.toString('utf8');
  const $ = cheerio.load(vendor.body.toString('utf8'));
  const vendorText = $.text().replace(/\s+/g, ' ');
  const links = $('a[href]').toArray().map(node => $(node).attr('href'));
  const files = [];
  for (const [kind, response] of [['csv', csv], ['json', json]]) {
    const url = `${vendorBase}.${kind}`;
    const header = (await parsePayload(response.body, response.headers['content-type'] || '')).parsed
      .find(item => item.innerKind === kind && item.mrfHospitalName);
    if (response.status !== 200 || response.body.length !== 262144
        || !links.includes(url) || header?.mrfHospitalName !== 'Greenwood Leflore Hospital'
        || header.mrfLocationName !== 'Greenwood Leflore Hospital'
        || header.mrfAddress !== '1401 River Rd, , Greenwood, MS 38930'
        || header.mrfLicenseState !== 'MS' || header.declaredLastUpdated !== '2026-08-05'
        || header.cmsVersion !== '3.0.0')
      throw new Error(`Greenwood ${kind} page/file evidence changed: ` + JSON.stringify({
        status: response.status, bytes: response.body.length, linked: links.includes(url), header,
      }));
    const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
    fs.mkdirSync(sampleDir, { recursive: true });
    const samplePath = path.join(sampleDir, `${response.sha256}.bin`);
    fs.writeFileSync(samplePath, response.body);
    files.push({ kind, url, http_status: response.status, sample_sha256: response.sha256,
      sample_bytes: response.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
      declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
      declared_address: header.mrfAddress, declared_license_state: header.mrfLicenseState,
      declared_date: header.declaredLastUpdated, version: header.cmsVersion,
      observed_at: response.checkedAt });
  }
  if (identity.status !== 200 || !identityText.includes('formerly Greenwood Leflore Hospital')
      || !identityText.includes('1401 River Road') || !identityText.includes('Greenwood, MS 38930-4030')
      || pricing.status !== 200 || pricingText.includes('Greenwood Hospital Standard Charges')
      || pointer.status !== 206 || pointerText.includes('Greenwood')
      || legacyPointer.status !== 404
      || legacyPointer.finalUrl.toLowerCase() !== 'https://www.umc.edu/greenwood/cms-hpt.txt'
      || vendor.status !== 200 || !vendorText.includes('Updated 8/5/2026'))
    throw new Error('Greenwood current publisher, legacy route, or vendor page changed: ' + JSON.stringify({
      identityStatus: identity.status, pricingStatus: pricing.status, pointerStatus: pointer.status,
      pointerHasGreenwood: pointerText.includes('Greenwood'), legacyStatus: legacyPointer.status,
      legacyFinalUrl: legacyPointer.finalUrl, vendorStatus: vendor.status,
    }));
  const nextAction = 'Confirm with current UMMC Greenwood publication which root cms-hpt.txt entry and MRF apply to CCN 250099 after the August 1 acquisition. Recheck the exact current publisher pointer and file bytes; keep the former GLH AccuReg CSV/JSON as dated page-linked leads, not a verified current pointer chain.';
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    current_publisher_domain: 'umc.edu', current_identity_url: identityUrl,
    current_identity_sha256: identity.sha256,
    official_transition_source_url: 'https://umc.edu/Greenwood/Patients-Visitors/Bill-Pay.html',
    official_transition_statement: 'UMMC acquired Greenwood Leflore Hospital effective August 1, 2026; it is now UMMC Greenwood.',
    current_pricing_url: pricingUrl, current_pricing_sha256: pricing.sha256,
    current_pointer_url: pointerUrl, current_pointer_status: pointer.status,
    current_pointer_sha256: pointer.sha256, current_pointer_lists_greenwood: false,
    legacy_pointer_url: legacyPointerUrl, legacy_pointer_status: legacyPointer.status,
    legacy_pointer_final_url: legacyPointer.finalUrl,
    former_publisher_vendor_page_url: vendorPageUrl, vendor_page_status: vendor.status,
    vendor_page_sha256: vendor.sha256, vendor_page_declared_update: '2026-08-05',
    vendor_files: files, current_pointer_file_chain_verified: false,
    observed_at: new Date().toISOString(), next_action: nextAction,
  };
  const proofPath = path.join(audit, 'reconciliation-greenwood-transition-review.json');
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n');
  const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
  if (manual.records.some(row => row.ccn === ccn))
    throw new Error('Existing Greenwood manual review requires manual reconciliation');
  manual.records.push({ ccn, observed_at: proof.observed_at, proof_file: path.basename(proofPath),
    official_identity_url: identityUrl, official_pricing_page: pricingUrl,
    pointer_url: pointerUrl, current_root_pointer_client_status: pointer.status,
    former_publisher_page: vendorPageUrl,
    page_linked_mrf_urls: files.map(file => file.url),
    disposition: 'publisher-transition-former-page-files-current-pointer-unassigned',
    next_action: nextAction });
  manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, current_pointer_status: pointer.status,
    current_pointer_lists_greenwood: false, vendor_files: files.length }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
