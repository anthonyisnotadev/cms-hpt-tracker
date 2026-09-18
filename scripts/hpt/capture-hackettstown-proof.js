'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const facilityUrl = 'https://www.atlantichealth.org/locations/hackettstown-medical-center';
const pricingUrl = 'https://www.atlantichealth.org/patient-resources/insurance-cost/surprise-bill-protection-and-transparency';
const pointerUrl = 'https://atlantichealth.org/cms-hpt.txt';
const fileUrl = 'https://www.atlantichealth.org/content/dam/ahs/insurance/price-transparency/52-1958352_hackettstown-medical-center_standardcharges.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '310115');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '310115');
  if (!roster || roster['Facility Name'] !== 'AHS HOSPITAL CORP'
      || roster.Address !== '651 WILLOW GROVE ST' || roster['City/Town'] !== 'HACKETTSTOWN'
      || roster.State !== 'NJ' || roster['ZIP Code'] !== '07840'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.pointer_url !== pointerUrl)
    throw new Error('Hackettstown roster or previous assignment changed');
  const [pointer, file] = await Promise.all([
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes('location-name: Hackettstown Medical Center'));
  const safeEntry = entry?.split(/\r?\n/).filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv');
  if (![200, 206].includes(pointer.status)
      || !safeEntry?.includes('location-name: Hackettstown Medical Center')
      || !safeEntry.some(line => line.endsWith('/surprise-bill-protection-and-transparency.html'))
      || !safeEntry.includes(`mrf-url: ${fileUrl}`)
      || ![200, 206].includes(file.status) || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'Hackettstown Medical Center'
      || parsed.mrfLocationName !== 'Hackettstown Medical Center'
      || parsed.mrfAddress !== '651 Willow Grove St, Hackettstown, NJ 07840'
      || parsed.mrfLicenseState !== 'NJ' || parsed.declaredLastUpdated !== '2026-04-01'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Hackettstown pointer or CSV metadata changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn: '310115', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    current_facility_name: 'Hackettstown Medical Center',
    first_party_facility_url: facilityUrl, first_party_pricing_url: pricingUrl,
    first_party_pages_reviewed_via: 'web search/open on 2026-09-16; direct bounded client received JavaScript shell',
    pricing_page_label_updated: '2026-04-28',
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_entry_without_contacts: safeEntry, pointer_location_name: 'Hackettstown Medical Center',
    file_url: fileUrl, file_http_status: file.status,
    file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, observed_at: file.checkedAt,
    limitation: 'Only 262,144 of 862,623,349 CSV bytes were retained. The first-party pricing page labels its link updated April 28, separately from the CSV-declared April 1 date. Complete-file validity and legal compliance were not determined.',
  };
  const evidence = {
    identity: 'corroborated', identity_basis: 'cms-roster-exact-hackettstown-street-first-party-facility-and-pricing-page-live-pointer-csv-header',
    officialDomain: 'atlantichealth.org', identityPageUrl: facilityUrl,
    sourcePageUrl: pricingUrl, pointerUrl, pointerSha256: pointer.sha256,
    pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status,
    checked_at: file.checkedAt, date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: parsed.mrfLocationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'csv',
    next_action: 'Validate the complete current CSV and keep the pricing-page label date separate from the CSV-declared update date before any compliance conclusion.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === '310115')) throw new Error('Existing Hackettstown resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-hackettstown-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn: '310115', base, action: 'replace', evidence,
    evidence_run: 'hackettstown-ahs-corp-exact-campus-2026-09-16', reviewed_at: file.checkedAt,
    note: 'The roster calls CCN 310115 AHS Hospital Corp at 651 Willow Grove Street, Hackettstown. Atlantic Health identifies Hackettstown Medical Center at that exact campus; its public pricing page and live root pointer name the same CSV. Bounded file bytes declare the exact campus, New Jersey, 2026-04-01 and v3.0.0. The pricing page separately labels its link updated April 28. This is a pointer/page/header observation, not complete-file validation or a legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '310115', pointer_sha256: pointer.sha256,
    sample_sha256: file.sha256, declared_date: parsed.declaredLastUpdated }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
