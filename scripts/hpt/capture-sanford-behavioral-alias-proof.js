'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '244018';
const identityUrl = 'https://www.sanfordhealth.org/locations/sanford-thief-river-falls-behavioral-health-center';
const pricingUrl = 'https://www.sanfordhealth.org/patients-and-visitors/billing-and-insurance/price-estimates';
const pointerUrl = 'https://sanfordhealth.org/cms-hpt.txt';
const sourceUrl = 'https://search.hospitalpriceindex.com/hpi2/machineReadable/SanfordBehavioralHealth/13728';
const fileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/13728/450409348_sanford-behavioral-health-thief-river-falls_standardcharges.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'SANFORD BEHAVIORAL HEALTH CENTER'
      || roster.Address !== '120 LABREE AVENUE SOUTH' || roster['City/Town'] !== 'THIEF RIVER FALLS'
      || roster.State !== 'MN' || roster['ZIP Code'] !== '56701'
      || base?.finding !== 'not-assessed-domain-unknown' || base.domain || base.pointer_url)
    throw new Error('Sanford behavioral roster or previous assessment changed');
  const [identity, pricing, pointer, file] = await Promise.all([
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const priceLinks = $pricing('a').map((_, node) => ({ label: $pricing(node).text().replace(/\s+/g, ' ').trim(),
    href: $pricing(node).attr('href') })).get();
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes('location-name: Sanford Behavioral Health Thief River Falls'));
  const safeEntry = entry?.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream'))
    .parsed.find(item => item.innerKind === 'csv');
  if ([identity, pricing, pointer, file].some(result => ![200, 206].includes(result.status))
      || !identityText.includes('Sanford Thief River Falls Behavioral Health Center')
      || !identityText.includes('120 LaBree Ave. S.')
      || !identityText.includes('Thief River Falls, Minnesota 56701')
      || !priceLinks.some(link => link.label === 'Sanford Behavioral Health Thief River Falls' && link.href === fileUrl)
      || !safeEntry?.includes('location-name: Sanford Behavioral Health Thief River Falls')
      || !safeEntry.includes(`source-page-url: ${sourceUrl}`)
      || !safeEntry.includes(`mrf-url: ${fileUrl}`)
      || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'Sanford Behavioral Health Thief River Falls'
      || parsed.mrfLocationName !== 'Sanford Behavioral Health Thief River Falls'
      || parsed.mrfAddress !== '120 Labree Ave S, Thief River Falls, MN 56701'
      || parsed.mrfLicenseState !== 'MN' || parsed.declaredLastUpdated !== '2026-03-04'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Sanford behavioral site, pricing link, pointer, or CSV header changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    first_party_identity_url: identityUrl, first_party_identity_sha256: identity.sha256,
    first_party_pricing_url: pricingUrl, first_party_pricing_sha256: pricing.sha256,
    first_party_historical_name_url: 'https://www.sanfordhealth.org/-/media/org/files/about/community-health-needs-assessment/2024/thief-river-falls-behavioral-health-center-chna-report-2025-2027.pdf',
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_entry_without_contacts: safeEntry, pointer_source_url: sourceUrl,
    file_url: fileUrl, file_http_status: file.status,
    file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, observed_at: file.checkedAt,
    limitation: 'Only 262,144 CSV bytes were retained. Exact-campus identity, page and pointer linkage, and header metadata were checked; complete-file validity and legal compliance were not determined.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing Sanford behavioral resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-sanford-behavioral-alias-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace', evidence: {
    identity: 'corroborated', identity_basis: 'first-party-exact-sanford-behavioral-campus-pricing-page-root-pointer-csv-header',
    officialDomain: 'sanfordhealth.org', identityPageUrl: identityUrl, identityPageSha256: identity.sha256,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: parsed.mrfLocationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'csv',
    next_action: 'Validate the complete current CSV before any schema or legal-compliance conclusion.',
  }, evidence_run: 'sanford-behavioral-exact-campus-2026-09-16', reviewed_at: file.checkedAt,
  note: 'The roster Sanford Behavioral Health Center and the current Sanford Thief River Falls Behavioral Health Center share the exact 120 LaBree Avenue South campus. Sanford lists a distinct behavioral hospital price file alongside the Thief River Falls Medical Center file; the behavioral file agrees with the live root-pointer entry and its bounded header declares the same campus, MN, 2026-03-04 and v3.0.0. This is bounded identity/pointer/file evidence, not complete-file validation or a legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, sample_sha256: file.sha256,
    declared_date: parsed.declaredLastUpdated }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
