'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '180092';
const renameUrl = 'https://www.centerpointhealth.com/news/2026/01/15/central-kentucky-hospitals-unite-as-centerpoint-health';
const facilityUrl = 'https://www.centerpointhealth.com/winchester';
const pricingUrl = 'https://www.centerpointhealth.com/hospital-charges-listing';
const pointerUrl = 'https://centerpointhealth.com/cms-hpt.txt';
const fileUrl = 'https://www.centerpointhealth.com/docs/ahcenterpointhealthlibraries/hcl/mrf3q2026/621772321_clark-regional-medical-center_standardcharges.csv.zip';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'CLARK REGIONAL MEDICAL CENTER'
      || roster.Address !== '175 HOSPITAL DRIVE' || roster['City/Town'] !== 'WINCHESTER'
      || roster.State !== 'KY' || roster['ZIP Code'] !== '40391'
      || base?.finding !== 'not-assessed-not-named-in-file' || base.pointer_url !== pointerUrl)
    throw new Error('Winchester roster or prior assessment changed');
  const [rename, facility, pricing, pointer, file] = await Promise.all([
    retrieve(renameUrl, 262144, { timeoutMs: 30000 }),
    retrieve(facilityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const text = result => cheerio.load(result.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const priceLinks = $pricing('a').map((_, node) => new URL($pricing(node).attr('href') || '/', pricingUrl).href).get();
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes('location-name: Centerpoint Health - Winchester'));
  const safeEntry = entry?.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream')).parsed
    .find(item => item.innerKind === 'csv');
  if ([rename, facility, pricing, pointer, file].some(result => ![200, 206].includes(result.status))
      || !text(rename).includes('Clark Regional Medical Center is now Centerpoint Health')
      || !text(rename).includes('Winchester')
      || !text(facility).includes('Centerpoint Health - Winchester')
      || !text(facility).includes('175 Hospital Dr')
      || !text(facility).includes('Winchester, KY 40391')
      || !priceLinks.includes(fileUrl)
      || !safeEntry?.includes('location-name: Centerpoint Health - Winchester')
      || !safeEntry.includes(`mrf-url: ${fileUrl}`)
      || file.body.length !== 262144
      || parsed?.mrfHospitalName.trim() !== 'Clark Regional Medical Center'
      || parsed.mrfAddress.trim() !== '175 Hospital Drive Winchester KY 40391'
      || parsed.mrfLicenseState !== 'NC' || parsed.declaredLastUpdated !== '2026-07-10'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Winchester rename, campus, price link, pointer, or state conflict changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing Winchester resolution requires manual review');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    first_party_rename_url: renameUrl, first_party_rename_sha256: rename.sha256,
    first_party_facility_url: facilityUrl, first_party_facility_sha256: facility.sha256,
    first_party_pricing_url: pricingUrl, first_party_pricing_sha256: pricing.sha256,
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_entry_without_contacts: safeEntry,
    file_url: fileUrl, file_http_status: file.status, file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'), sample_sha256: file.sha256,
    archive_member_kind: parsed.innerKind, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, facility_state: roster.State, declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    observed_at: file.checkedAt,
    limitation: 'Only the first 262,144 bytes of a 2,627,316-byte ZIP were retained. The file identifies this campus but the license-number field names NC, not KY. Full member validity and legal compliance were not determined.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-centerpoint-winchester-state-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace-observation', evidence: {
    identity: 'corroborated', identity_basis: 'first-party-explicit-clark-regional-rename-exact-winchester-campus-pricing-page-root-pointer-csv-header-with-license-state-conflict',
    officialDomain: 'centerpointhealth.com', identityPageUrl: facilityUrl, identityPageSha256: facility.sha256,
    renamePageUrl: renameUrl, renamePageSha256: rename.sha256,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: 'Centerpoint Health - Winchester', declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'csv',
    observedFinding: 'mrf-license-state-field-conflicts-facility',
    next_action: 'Ask publisher to confirm/correct the NC license-number field; validate the complete ZIP/member before any schema or legal-compliance conclusion.',
  }, evidence_run: 'centerpoint-winchester-clark-regional-state-conflict-2026-09-16', reviewed_at: file.checkedAt,
  note: 'Centerpoint explicitly says Clark Regional Medical Center became Centerpoint Health - Winchester at 175 Hospital Dr. The current price page and root pointer link the same ZIP, and its bounded CSV member header identifies Clark Regional at that exact address, declaring 2026-07-10 and v3.0.0. However, the parsed license-number field names NC rather than the Kentucky facility state. Retain this explicit publisher metadata conflict; do not call it a legal-compliance failure or a clean verified MRF.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, sample_sha256: file.sha256, observed_finding: 'mrf-license-state-field-conflicts-facility' }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
