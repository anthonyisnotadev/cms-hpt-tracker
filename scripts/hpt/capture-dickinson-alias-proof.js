'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '230055';
const identityUrl = 'https://www.marshfieldclinic.org/locations/dickinson-marshfield-medical-center';
const pricingUrl = 'https://www.marshfieldclinic.org/patient-resources/billing/cms-hospital-transparency-requirement';
const pointerUrl = 'https://marshfieldclinic.org/cms-hpt.txt';
const fileUrl = 'https://www.marshfieldclinic.org/-/media/marshfieldclinic/files/patient%20resources/cms-hpt-documents/382780429_marshfield-medical-center--dickinson_standardcharges.csv';
const pageFileUrl = 'https://www.marshfieldclinic.org/-/media/marshfieldclinic/files/patient-resources/cms-hpt-documents/382780429_marshfield-medical-center--dickinson_standardcharges.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'DICKINSON COUNTY MEMORIAL HOSPITAL'
      || roster.Address !== '1721 S STEPHENSON AVE' || roster['City/Town'] !== 'IRON MOUNTAIN'
      || roster.State !== 'MI' || roster['ZIP Code'] !== '49801'
      || base?.finding !== 'not-assessed-not-named-in-file' || base.pointer_url !== pointerUrl)
    throw new Error('Dickinson roster or previous assessment changed');
  const [identity, pricing, pointer, file, pageFile] = await Promise.all([
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
    retrieve(pageFileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const pricingLinks = $pricing('a').map((_, item) => $pricing(item).attr('href')).get()
    .map(href => new URL(href, pricingUrl).href);
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes('location-name: Marshfield Medical Center Dickinson Hospital'));
  const safeEntry = entry?.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream'))
    .parsed.find(item => item.innerKind === 'csv');
  if ([identity, pricing, pointer, file, pageFile].some(result => ![200, 206].includes(result.status))
      || !identityText.includes('Marshfield Medical Center – Dickinson')
      || !identityText.includes('1721 S Stephenson Ave')
      || !pricingLinks.includes(pageFileUrl)
      || !safeEntry?.includes('location-name: Marshfield Medical Center Dickinson Hospital')
      || !safeEntry.includes(`mrf-url: ${fileUrl}`)
      || file.body.length !== 262144
      || pageFile.body.length !== 262144 || pageFile.sha256 !== file.sha256
      || parsed?.mrfHospitalName !== 'Marshfield Medical Center - Dickinson'
      || parsed.mrfAddress !== '1721 South Stephenson Avenue, Iron Mountain, MI 49801'
      || parsed.mrfLicenseState !== 'MI' || parsed.declaredLastUpdated !== '2026-02-19'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Dickinson identity, pricing link, pointer, or CSV header changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    first_party_identity_url: identityUrl, first_party_identity_sha256: identity.sha256,
    first_party_pricing_url: pricingUrl, first_party_pricing_sha256: pricing.sha256,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_entry_without_contacts: safeEntry, file_url: fileUrl, file_http_status: file.status,
    page_file_url: pageFileUrl, page_file_http_status: pageFile.status,
    page_file_sample_sha256: pageFile.sha256,
    file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    observed_at: file.checkedAt,
    historical_name_context_url: 'https://www.marshfieldclinic.org/-/media/marshfieldclinic/files/about-us/community-health-needs-assessment-reports/dickinson/2024-26-dickinson-chna.pdf',
    limitation: 'Only 262,144 CSV bytes were retained from each URL. The pricing-page URL differs from the pointer URL, although their sampled bytes and reported total size agree. Complete-file identity, validity and legal compliance were not determined.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing Dickinson resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-dickinson-alias-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace', evidence: {
    identity: 'corroborated', identity_basis: 'first-party-current-dickinson-hospital-exact-campus-pricing-page-root-pointer-csv-header',
    officialDomain: 'marshfieldclinic.org', identityPageUrl: identityUrl, identityPageSha256: identity.sha256,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: 'Marshfield Medical Center Dickinson Hospital', declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'csv',
    next_action: 'Validate the complete current 138.8 MB CSV before any schema or legal-compliance conclusion.',
  }, evidence_run: 'dickinson-exact-campus-alias-2026-09-16', reviewed_at: file.checkedAt,
  note: 'The current Marshfield hospital page, pricing page, live root pointer and bounded CSV header all identify the 1721 South Stephenson Avenue, Iron Mountain campus. The roster retains its historical Dickinson County Memorial Hospital name. A first-party hospital assessment documents Dickinson County Healthcare System d/b/a Marshfield Medical Center-Dickinson. Pricing-page and pointer URLs have different path spellings but return identical 262,144-byte samples and the same reported file size. This is a bounded identity/pointer/file observation, not complete-file validation or a legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, sample_sha256: file.sha256,
    declared_date: parsed.declaredLastUpdated }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
