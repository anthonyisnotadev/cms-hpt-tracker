'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '390116';
const homeUrl = 'https://suburbanbhc.org/';
const pricingUrl = 'https://suburbanbhc.org/financial-assistance/';
const pointerUrl = 'https://suburbanhosp.org/cms-hpt.txt';
const fileUrl = 'https://suburbanbhc.org/wp-content/uploads/2026/09/910401_RoxboroughMemorialHospital_standardcharges.json';
const siblingFileUrl = 'https://roxboroughmemorial.com/wp-content/uploads/2026/09/910401_RoxboroughMemorialHospital_standardcharges.json';
const locationName = 'Suburban Behavioral Health Campus of Roxborough Memorial Hospital';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'SUBURBAN COMMUNITY HOSPITAL'
      || roster.Address !== '2701 DEKALB PIKE' || roster['City/Town'] !== 'NORRISTOWN'
      || roster.State !== 'PA' || roster['ZIP Code'] !== '19401'
      || base?.finding !== 'not-assessed-not-named-in-file'
      || base.pointer_url !== pointerUrl)
    throw new Error('Suburban roster or prior assessment changed');
  const [home, pricing, pointer, file, sibling] = await Promise.all([
    retrieve(homeUrl, 1048576, { timeoutMs: 35000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 1048576, { timeoutMs: 35000 }),
    retrieve(siblingFileUrl, 1048576, { timeoutMs: 35000 }),
  ]);
  const homeText = cheerio.load(home.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const pricingHtml = pricing.body.toString('utf8');
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes(`location-name: ${locationName}`));
  const safeEntry = entry?.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/json')).parsed
    .find(item => item.innerKind === 'json');
  if ([home, pricing, pointer, file, sibling].some(result => ![200, 206].includes(result.status))
      || !homeText.includes('formerly known as Suburban Community Hospital')
      || !homeText.includes('2701 Dekalb Pike, Norristown, PA 19401')
      || !pricingHtml.includes(fileUrl)
      || !safeEntry?.includes(`location-name: ${locationName}`)
      || !safeEntry.includes(`source-page-url: ${pricingUrl}`)
      || !safeEntry.includes(`mrf-url: ${fileUrl}`)
      || file.body.length !== 1048576 || sibling.body.length !== 1048576
      || file.sha256 !== sibling.sha256
      || parsed?.mrfHospitalName !== 'Roxborough Memorial Hospital'
      || parsed.mrfLocationName !== `Roxborough Memorial Hospital|${locationName}`
      || parsed.mrfAddress !== '5800 Ridge Avenue Philadelphia, PA  19128|2701 DeKalb Pike East Norriton, PA  19401'
      || parsed.mrfLicenseState !== 'PA' || parsed.declaredLastUpdated !== '2026-09-01'
      || parsed.cmsVersion !== '3.0')
    throw new Error('Suburban rename, exact campus, pointer, or shared-file metadata changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing Suburban resolution requires manual review');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    first_party_home_url: homeUrl, first_party_home_sha256: home.sha256,
    first_party_former_name_phrase: 'formerly known as Suburban Community Hospital',
    first_party_current_address: '2701 Dekalb Pike, Norristown, PA 19401',
    first_party_pricing_url: pricingUrl, first_party_pricing_sha256: pricing.sha256,
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_entry_without_contacts: safeEntry,
    file_url: fileUrl, file_http_status: file.status,
    file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    sibling_file_url: siblingFileUrl, sibling_file_sample_sha256: sibling.sha256,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_names: parsed.mrfLocationName, declared_addresses: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, expected_version: '3.0.0', observed_at: file.checkedAt,
    limitation: 'The former Suburban campus is named separately from Roxborough in the live pointer and shared JSON. The declared version is literal 3.0 rather than 3.0.0. Only 1048576 bytes of a 30114303-byte file were retained, and the sibling-host prefix matched. Current CCN enrollment, full-file validity and legal compliance were not determined.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-suburban-behavioral-alias-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace-observation', evidence: {
    identity: 'corroborated', identity_basis: 'first-party-explicit-suburban-former-name-exact-campus-pricing-page-root-pointer-shared-json-location',
    officialDomain: 'suburbanhosp.org', identityPageUrl: homeUrl, identityPageSha256: home.sha256,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion, expected_version: '3.0.0',
    location_name: locationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'json',
    observedFinding: 'mrf-template-version-noncanonical',
    next_action: 'Confirm publisher correction of the literal 3.0 version to the canonical template version, then validate the complete shared file and current CCN enrollment; do not assign Roxborough-only evidence to Suburban.',
  }, evidence_run: 'suburban-behavioral-former-name-shared-json-2026-09-16', reviewed_at: file.checkedAt,
  note: 'The Suburban Behavioral Health Campus website explicitly says it was formerly Suburban Community Hospital at 2701 DeKalb Pike. Its current root pointer has a separate Suburban location and the pricing page links the same JSON. A bounded shared-file prefix includes the 2701 DeKalb Pike campus and PA field, 2026-09-01, but declares noncanonical version 3.0 rather than 3.0.0. This is a specific observed template metadata issue, not clean complete-file validation or a legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, sample_sha256: file.sha256,
    observed_finding: 'mrf-template-version-noncanonical' }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
