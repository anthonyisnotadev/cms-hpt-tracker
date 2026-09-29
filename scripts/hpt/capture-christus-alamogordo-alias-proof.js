'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { csvToObjects } = require('./lib/util');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '320004';
const identityUrl = 'https://www.christushealth.org/locations/alamogordo-hospital';
const pricingUrl = 'https://www.christushealth.org/plan-care/bill-pay/pricing-transparency';
const pointerUrl = 'https://www.christushealth.org/cms-hpt.txt';
const fileUrl = 'https://www.christushealth.org/-/media/christus-health/plan-care/files/bill-pay/machine-readable-files/850138775_geraldchampionregionalmedicalcenter_standardcharges.ashx';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (!roster || roster['Facility Name'] !== 'CHRISTUS SOUTHERN NEW MEXICO'
      || roster.Address !== '2669 SCENIC DRIVE' || roster['City/Town'] !== 'ALAMOGORDO'
      || roster.State !== 'NM' || roster['ZIP Code'] !== '88310'
      || !base || base.finding !== 'not-assessed-domain-unknown')
    throw new Error('CHRISTUS Alamogordo roster or base assessment changed');
  const [identity, pricing, pointer, file] = await Promise.all([
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const $ = cheerio.load(pricing.body.toString('utf8'));
  const pricingText = $.text().replace(/\s+/g, ' ');
  const pricingLinks = $('a[href]').toArray().map(node => new URL($(node).attr('href'), pricingUrl).href);
  const block = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(text => /^location-name: Gerald Champion Regional Medical Center\s*$/m.test(text));
  const fields = Object.fromEntries((block || '').split(/\r?\n/).map(line => {
    const at = line.indexOf(': ');
    return at < 0 ? [] : [line.slice(0, at), line.slice(at + 2).trim()];
  }).filter(pair => pair.length === 2));
  const header = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream'))
    .parsed.find(item => item.innerKind === 'json' && item.mrfHospitalName);
  if (![200, 206].includes(identity.status) || identity.body.length !== 149729
      || !identityText.includes('CHRISTUS Southern New Mexico')
      || !identityText.includes('Gerald Champion')
      || !identityText.includes('2669 N. Scenic Dr.')
      || !identityText.includes('Alamogordo, NM 88310')
      || ![200, 206].includes(pricing.status) || pricing.body.length !== 99371
      || !pricingText.includes('CHRISTUS Gerald Champion Regional Medical Center')
      || !pricingLinks.includes(fileUrl)
      || ![200, 206].includes(pointer.status) || pointer.body.length !== 16906
      || fields['location-name'] !== 'Gerald Champion Regional Medical Center'
      || fields['mrf-url'] !== fileUrl
      || file.status !== 206 || file.body.length !== 262144
      || file.headers['content-range'] !== 'bytes 0-262143/123728509'
      || header?.mrfHospitalName !== 'Gerald Champion Regional Medical Center'
      || header.mrfLocationName !== 'Gerald Champion Regional Medical Center'
      || header.mrfAddress !== '2669 N Scenic Dr, Alamogordo, NM 88310'
      || header.mrfLicenseState !== 'NM' || header.declaredLastUpdated !== '2026-01-12'
      || header.cmsVersion !== '3.0.0')
    throw new Error('CHRISTUS Alamogordo alias, pointer, or file changed: ' + JSON.stringify({
      identityStatus: identity.status, identityBytes: identity.body.length,
      currentName: identityText.includes('CHRISTUS Southern New Mexico'),
      alias: identityText.includes('Gerald Champion'), campus: identityText.includes('2669 N. Scenic Dr.'),
      pricingStatus: pricing.status, pricingBytes: pricing.body.length, pageLinksFile: pricingLinks.includes(fileUrl),
      pointerStatus: pointer.status, pointerBytes: pointer.body.length,
      pointerLocation: fields['location-name'], pointerFile: fields['mrf-url'],
      fileStatus: file.status, fileBytes: file.body.length, range: file.headers['content-range'], header,
    }));
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    official_domain: 'christushealth.org', identity_page_url: identityUrl,
    identity_page_sha256: identity.sha256,
    identity_page_current_name: 'CHRISTUS Southern New Mexico',
    identity_page_former_name: 'Gerald Champion',
    identity_page_address: '2669 N. Scenic Dr., Alamogordo, NM 88310',
    pricing_page_url: pricingUrl, pricing_page_sha256: pricing.sha256,
    pricing_page_names_former_facility: true, pricing_page_links_file: true,
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_bytes: pointer.body.length,
    pointer_location_name: fields['location-name'], pointer_mrf_url: fields['mrf-url'],
    file_http_status: file.status, file_sample_sha256: file.sha256,
    file_sample_bytes: file.body.length, file_total_bytes: 123728509,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName, declared_address: header.mrfAddress,
    declared_license_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Validate the full 123,728,509-byte JSON and recheck the exact pointer/file on a publisher update. Keep the current CHRISTUS Southern New Mexico name and former Gerald Champion file/pointer name as documented aliases at the same campus; bounded header evidence is not a full-schema or legal compliance verdict.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-christus-alamogordo-alias-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, sample_sha256: file.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
