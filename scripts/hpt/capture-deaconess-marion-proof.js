'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const identityUrl = 'https://www.deaconess.com/illinois/deaconess-illinois-medical-center';
const pricingUrl = 'https://www.deaconess.com/pay-my-bill/pricing';
const pointerUrl = 'https://deaconess.com/cms-hpt.txt';
const portalUrl = 'https://search.hospitalpriceindex.com/hpi2/machineReadable/DeaconessRegionalHealthcareServicesofIllinois/10475';
const fileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/10475/810693478_deaconess-regional-healthcare-services-illinois-inc_standardcharges.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '140184');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '140184');
  if (!roster || roster['Facility Name'] !== 'HEARTLAND REGIONAL MEDICAL CENTER'
      || roster.Address !== '3333 W DEYOUNG' || roster['City/Town'] !== 'MARION'
      || roster.State !== 'IL' || roster['ZIP Code'] !== '62959'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.pointer_url !== pointerUrl)
    throw new Error('Marion roster or original Deaconess assignment changed');
  const [identity, pricing, pointer, file] = await Promise.all([
    retrieve(identityUrl, 262144, { timeoutMs: 25000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 25000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const pricingEntry = $pricing('a').map((_, element) => ({
    text: $pricing(element).text().replace(/\s+/g, ' ').trim(), href: $pricing(element).attr('href'),
  })).get().find(link => link.text.includes('Deaconess Illinois Medical Center - Chargemaster'));
  const pointerText = pointer.body.toString('utf8');
  const pointerEntry = pointerText.split(/\r?\n\r?\n/).find(entry => entry.startsWith('location-name: Deaconess Illinois Medical Center\n'));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv');
  if (![200, 206].includes(identity.status) || !identityText.includes('Deaconess Illinois Medical Center')
      || !/3333 W\. DeYoung St\.? Marion, IL 62959/.test(identityText)
      || ![200, 206].includes(pricing.status) || pricingEntry?.href !== portalUrl
      || ![200, 206].includes(pointer.status)
      || !pointerEntry?.includes(`source-page-url: ${portalUrl}`)
      || !pointerEntry.includes(`mrf-url: ${fileUrl}`)
      || ![200, 206].includes(file.status) || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'Deaconess Regional Healthcare Services Illinois Inc'
      || parsed.mrfLocationName !== 'Deaconess Illinois Medical Center'
      || parsed.mrfAddress !== '3333 W. Deyoung St., Marion, IL 62959'
      || parsed.mrfLicenseState !== 'IL' || parsed.declaredLastUpdated !== '2026-02-03'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Deaconess identity, pricing, pointer, or file metadata changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn: '140184', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    current_hospital_name: 'Deaconess Illinois Medical Center',
    first_party_identity_url: identityUrl, first_party_identity_sha256: identity.sha256,
    first_party_pricing_url: pricingUrl, first_party_pricing_sha256: pricing.sha256,
    pricing_page_portal_url: portalUrl,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_location_name: 'Deaconess Illinois Medical Center', file_url: fileUrl,
    file_http_status: file.status, file_content_range: file.headers['content-range'] || '',
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, observed_at: file.checkedAt,
    limitation: 'Only 262,144 of 337,257,000 file bytes were retained. Identity, pointer linkage, and header metadata were corroborated; full-file usability and legal compliance were not determined.',
  };
  const evidence = {
    identity: 'corroborated', identity_basis: 'deaconess-current-facility-page-exact-marion-street-pricing-portal-pointer-csv-header',
    officialDomain: 'deaconess.com', identityPageUrl: identityUrl, identityPageSha256: identity.sha256,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status,
    checked_at: file.checkedAt, date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: parsed.mrfLocationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'csv',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === '140184')) throw new Error('Existing Marion resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-deaconess-marion-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn: '140184', base, action: 'replace', evidence,
    evidence_run: 'deaconess-marion-alias-2026-09-16', reviewed_at: file.checkedAt,
    note: 'The roster names Heartland Regional Medical Center at 3333 W DeYoung, Marion. Deaconess currently names the exact campus Deaconess Illinois Medical Center; its pricing page links the same portal named in its root pointer, which directly names a CSV. Bounded CSV bytes declare the exact Marion street, Illinois, 2026-02-03, and CMS template 3.0.0. This verifies a current pointer/header chain, not complete-file validity or legal compliance.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '140184', pointer_sha256: pointer.sha256,
    sample_sha256: file.sha256, declared_version: parsed.cmsVersion }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
