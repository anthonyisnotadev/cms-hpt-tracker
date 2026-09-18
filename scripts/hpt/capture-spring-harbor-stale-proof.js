'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '204005';
const identityUrl = 'https://www.mainehealth.org/locations/mainehealth-behavioral-health-spring-harbor';
const pricingUrl = 'https://www.mainehealth.org/patients-visitors/billing-and-financial-services';
const pointerUrl = 'https://mainehealth.org/cms-hpt.txt';
const sourceUrl = 'https://search.hospitalpriceindex.com/hpi2/machineReadable/SpringHarborHospital/8065';
const fileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8065/010238552-1598798787_mainehealth_standardcharges.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'MAINEHEALTH BEHAVIORAL HEALTH AT SPRING HARBOR'
      || roster.Address !== '123 ANDOVER ROAD' || roster['City/Town'] !== 'WESTBROOK'
      || roster.State !== 'ME' || roster['ZIP Code'] !== '04092'
      || base?.finding !== 'not-assessed-not-named-in-file' || base.pointer_url !== pointerUrl)
    throw new Error('Spring Harbor roster or previous assessment changed');
  const [identity, pricing, pointer, file] = await Promise.all([
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const pricingText = $pricing('body').text().replace(/\s+/g, ' ');
  const pricingLinks = $pricing('a').map((_, item) => $pricing(item).attr('href')).get()
    .map(href => new URL(href, pricingUrl).href);
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes('location-name: Spring Harbor Hospital'));
  const safeEntry = entry?.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream'))
    .parsed.find(item => item.innerKind === 'csv');
  const ageDays = Math.floor((Date.parse(file.checkedAt) - Date.parse('2025-08-12T00:00:00Z')) / 86400000);
  if ([identity, pricing, pointer, file].some(result => ![200, 206].includes(result.status))
      || !identityText.includes('MaineHealth Behavioral Health at Spring Harbor')
      || !identityText.includes('Formerly known as Spring Harbor Hospital')
      || !identityText.includes('123 Andover Rd')
      || !pricingText.includes('MaineHealth Behavioral Health')
      || !pricingLinks.includes(fileUrl)
      || !safeEntry?.includes('location-name: Spring Harbor Hospital')
      || !safeEntry.includes(`source-page-url: ${sourceUrl}`)
      || !safeEntry.includes(`mrf-url: ${fileUrl}`)
      || file.body.length !== 262144 || ageDays <= 365
      || parsed?.mrfHospitalName !== 'MaineHealth'
      || parsed.mrfLocationName !== 'Spring Harbor Hospital'
      || parsed.mrfAddress !== '123 Andover Rd, Westbrook, ME 04092'
      || parsed.mrfLicenseState !== 'ME' || parsed.declaredLastUpdated !== '2025-08-12'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Spring Harbor identity, pricing, pointer, file header, or date changed');
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
    pointer_entry_without_contacts: safeEntry, pointer_source_url: sourceUrl,
    file_url: fileUrl, file_http_status: file.status,
    file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, age_days_at_observation: ageDays, observed_at: file.checkedAt,
    limitation: 'Only 262,144 CSV bytes were retained. The declared update date was over 365 days old at observation; complete-file validity and legal compliance were not determined.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing Spring Harbor resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-spring-harbor-stale-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace-observation', evidence: {
    identity: 'corroborated', identity_basis: 'first-party-explicit-spring-harbor-former-name-exact-campus-pricing-page-root-pointer-csv-header',
    officialDomain: 'mainehealth.org', identityPageUrl: identityUrl, identityPageSha256: identity.sha256,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: parsed.mrfLocationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'csv', observedFinding: 'mrf-stale-over-365-days',
    next_action: 'Check for a publisher-updated Spring Harbor CSV; then validate the complete file before any schema or legal-compliance conclusion.',
  }, evidence_run: 'spring-harbor-former-name-stale-file-2026-09-16', reviewed_at: file.checkedAt,
  note: 'MaineHealth explicitly calls the current 123 Andover Road campus formerly Spring Harbor Hospital. Its pricing page and live root pointer link the same CSV. Bounded bytes declare MaineHealth, the Spring Harbor Hospital location, exact campus, Maine, 2025-08-12 and v3.0.0. The declared update date is over 365 days old at observation; this is a dated file-metadata observation, not complete-file validation or a legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, sample_sha256: file.sha256,
    declared_date: parsed.declaredLastUpdated, age_days: ageDays }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
