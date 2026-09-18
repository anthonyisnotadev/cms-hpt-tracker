'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '154064';
const facilityUrl = 'https://assurancehealthsystem.com/locations/indianapolis/';
const andersonUrl = 'https://assurancehealthsystem.com/locations/anderson/';
const pricingUrl = 'https://assurancehealthsystem.com/price-transparency';
const pointerUrl = 'https://assurancehealthsystem.com/cms-hpt.txt';
const fileUrl = 'https://assurancehealthsystem.com/37-1787739_assurance-health-indianapolis-llc__standardcharges.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'ASSURANCE HEALTH PSYCHIATRIC HOSPITAL'
      || roster.Address !== '900 NORTH HIGH SCHOOL ROAD' || roster['City/Town'] !== 'INDIANAPOLIS'
      || roster.State !== 'IN' || roster['ZIP Code'] !== '46214'
      || base?.finding !== 'not-assessed-domain-unknown')
    throw new Error('Assurance Indianapolis roster or prior assessment changed');
  const [facility, anderson, pricing, pointer, file] = await Promise.all([
    retrieve(facilityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(andersonUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const text = result => cheerio.load(result.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const linked = $pricing('a').map((_, node) => $pricing(node).attr('href')).get().includes(fileUrl);
  const entries = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/);
  const entry = entries.find(block => block.includes('location-name: Assurance Health Indianapolis LLC'));
  const safeEntry = entry?.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed
    .find(item => item.innerKind === 'csv');
  const fileText = file.body.toString('utf8').replace(/^\uFEFF/, '');
  const lines = fileText.split(/\r?\n/);
  if ([facility, anderson, pricing, pointer, file].some(result => result.status !== 200)
      || !text(facility).includes('Assurance Health Indianapolis')
      || !text(facility).includes('900 N. High School Road')
      || !text(facility).includes('Indianapolis, IN 46214')
      || !text(anderson).includes('2725 Enterprise Drive')
      || !text(anderson).includes('Anderson, IN 46013')
      || !linked
      || !safeEntry?.includes('location-name: Assurance Health Indianapolis LLC')
      || !safeEntry.includes(`source-page-url: ${pricingUrl}`)
      || !safeEntry.includes(`mrf-url: ${fileUrl}`)
      || !lines[0].includes('license_number|IN')
      || !lines[1].includes(',154064,')
      || parsed?.mrfHospitalName !== 'Assurance Health LLC | Assurance Health Indianapolis LLC'
      || !parsed.mrfAddress.includes('900 N High School Road, Indianapolis, IN 46214')
      || !parsed.mrfAddress.includes('2725 Enterprise Drive, Anderson, IN 46013')
      || parsed.mrfLicenseState !== 'IN' || parsed.declaredLastUpdated !== '2026-04-01'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Assurance facility separation, price link, pointer, or file metadata changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing Assurance resolution requires manual review');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    first_party_indianapolis_url: facilityUrl, first_party_indianapolis_sha256: facility.sha256,
    first_party_anderson_url: andersonUrl, first_party_anderson_sha256: anderson.sha256,
    first_party_pricing_url: pricingUrl, first_party_pricing_sha256: pricing.sha256,
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_entry_without_contacts: safeEntry,
    file_url: fileUrl, file_status: file.status, file_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'), sample_sha256: file.sha256,
    declared_name: parsed.mrfHospitalName, declared_locations: parsed.mrfLocationName,
    declared_addresses: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    license_number_field: 'license_number|IN', license_number_value: ccn,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    observed_at: file.checkedAt,
    limitation: 'The shared CSV names separate Anderson and Indianapolis campuses. The exact Indianapolis address and metadata value 154064 support this CCN assignment; this check does not validate every charge row or determine legal compliance.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-assurance-indianapolis-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace', evidence: {
    identity: 'corroborated', identity_basis: 'first-party-indianapolis-campus-and-distinct-anderson-campus-pricing-page-root-pointer-csv-metadata-license-number',
    officialDomain: 'assurancehealthsystem.com', identityPageUrl: facilityUrl, identityPageSha256: facility.sha256,
    otherCampusPageUrl: andersonUrl, otherCampusPageSha256: anderson.sha256,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: 'Assurance Health Indianapolis LLC', declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'csv',
    next_action: 'Validate the complete CSV rows and cross-check the license number before any schema or legal-compliance conclusion.',
  }, evidence_run: 'assurance-indianapolis-exact-campus-license-metadata-2026-09-16', reviewed_at: file.checkedAt,
  note: 'Assurance first-party pages distinguish Indianapolis at 900 N High School Road from Anderson at 2725 Enterprise Drive. The live price page and root pointer link a shared CSV with both addresses and license_number|IN value 154064, matching this Indianapolis roster CCN. The parser reports 2026-04-01 and v3.0.0. This is source and identity evidence, not a full-file or legal-compliance verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, sample_sha256: file.sha256, declared_date: parsed.declaredLastUpdated }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
