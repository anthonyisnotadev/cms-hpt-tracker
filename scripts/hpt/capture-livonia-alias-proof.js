'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '230002';
const currentUrl = 'https://www.trinityhealthmichigan.org/location/trinity-health-livonia-hospital';
const oldNameUrl = 'https://www.trinityhealthmichigan.org/location/st-mary-mercy-livonia';
const pricingUrl = 'https://www.trinityhealthmichigan.org/tools-and-resources/billing-and-insurance/our-prices';
const pointerUrl = 'https://trinityhealthmichigan.org/cms-hpt.txt';
const fileUrl = 'https://hpt.trinity-health.org/383521763_st-mary-mercy-livonia_standardcharges.zip';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'ST JOE MERCY HOSPITAL SYSTEM LIVONIA'
      || roster.Address !== '36475 FIVE MILE ROAD' || roster['City/Town'] !== 'LIVONIA'
      || roster.State !== 'MI' || roster['ZIP Code'] !== '48154'
      || base?.finding !== 'not-assessed-not-named-in-file' || base.pointer_url !== pointerUrl)
    throw new Error('Livonia roster or previous assessment changed');
  const [current, oldName, pricing, pointer, file] = await Promise.all([
    retrieve(currentUrl, 262144, { timeoutMs: 30000 }),
    retrieve(oldNameUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const currentText = cheerio.load(current.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const oldNameText = cheerio.load(oldName.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const priceLinks = $pricing('a').map((_, node) => $pricing(node).attr('href')).get();
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes('location-name: Trinity Health Livonia Hospital'));
  const safeEntry = entry?.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream'))
    .parsed.find(item => item.innerKind === 'csv');
  if ([current, oldName, pricing, pointer, file].some(result => ![200, 206].includes(result.status))
      || !currentText.includes('Trinity Health Livonia Hospital')
      || !currentText.includes('36475 Five Mile Rd')
      || !currentText.includes('Livonia, MI 48154')
      || !oldNameText.includes('St Mary Mercy Livonia')
      || !oldNameText.includes('36475 Five Mile Rd')
      || !oldNameText.includes('Livonia, MI 48154')
      || !priceLinks.includes(fileUrl)
      || !safeEntry?.includes('location-name: Trinity Health Livonia Hospital')
      || !safeEntry.includes(`source-page-url: ${pricingUrl}`)
      || !safeEntry.includes(`mrf-url: ${fileUrl}`)
      || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'St Mary Mercy Livonia'
      || parsed.mrfLocationName !== 'St Mary Mercy Livonia'
      || parsed.mrfAddress !== '36475 Five Mile Rd, Livonia, MI 48154'
      || parsed.mrfLicenseState !== 'MI' || parsed.declaredLastUpdated !== '2026-03-31'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Livonia identity pages, pricing link, pointer, or archive header changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    first_party_current_facility_url: currentUrl, first_party_current_facility_sha256: current.sha256,
    first_party_old_name_url: oldNameUrl, first_party_old_name_sha256: oldName.sha256,
    first_party_pricing_url: pricingUrl, first_party_pricing_sha256: pricing.sha256,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_entry_without_contacts: safeEntry, file_url: fileUrl, file_http_status: file.status,
    file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, archive_member_kind: parsed.innerKind,
    declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    observed_at: file.checkedAt,
    limitation: 'Only the first 262,144 bytes of a 330,633,923-byte ZIP were retained. Current and older-name publisher pages share the exact campus, but complete archive/member validity and legal compliance were not determined.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing Livonia resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-livonia-alias-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace', evidence: {
    identity: 'corroborated', identity_basis: 'first-party-current-and-old-name-exact-livonia-campus-pricing-page-root-pointer-csv-archive-header',
    officialDomain: 'trinityhealthmichigan.org', identityPageUrl: currentUrl, identityPageSha256: current.sha256,
    oldNamePageUrl: oldNameUrl, oldNamePageSha256: oldName.sha256,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: 'Trinity Health Livonia Hospital', declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'csv',
    next_action: 'Validate the complete 330 MB ZIP and CSV member before any schema or legal-compliance conclusion.',
  }, evidence_run: 'livonia-trinity-st-mary-mercy-exact-campus-2026-09-16', reviewed_at: file.checkedAt,
  note: 'Trinity Health Michigan keeps current Trinity Health Livonia Hospital and St Mary Mercy Livonia facility pages at the same 36475 Five Mile Road campus. Its price page and live Trinity Michigan root pointer link the same ZIP, whose bounded CSV member header declares St Mary Mercy Livonia, the exact Livonia campus, MI, 2026-03-31 and v3.0.0. This is bounded identity/pointer/archive evidence, not complete-file validation or a legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, sample_sha256: file.sha256,
    declared_date: parsed.declaredLastUpdated }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
