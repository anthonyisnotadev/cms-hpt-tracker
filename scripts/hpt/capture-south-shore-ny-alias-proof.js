'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '330043';
const renameUrl = 'https://jobs.northwell.edu/blog/2021/03/08/eight-reasons-you-should-join-the-cardiac-cath-electrophysiology-team-at-south-shore-university-hospital/';
const stateDirectoryUrl = 'https://profiles.health.ny.gov/directory/hospitals';
const pricingUrl = 'https://www.northwell.edu/billing-and-insurance/price-estimator-tools';
const pointerUrl = 'https://www.northwell.edu/cms-hpt.txt';
const fileUrl = 'https://www.northwell.edu/sites/northwell.edu/files/machine-readable-files/South_Shore_University_Hospital_StandardCharges.zip';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'NS/LIJ HS SOUTHSIDE HOSPITAL'
      || roster.Address !== '301 EAST MAIN STREET' || roster['City/Town'] !== 'BAY SHORE'
      || roster.State !== 'NY' || roster['ZIP Code'] !== '11706'
      || base?.finding !== 'not-assessed-not-named-in-file' || base.pointer_url !== pointerUrl)
    throw new Error('Southside roster or previous assessment changed');
  const [rename, directory, pricing, pointer, file] = await Promise.all([
    retrieve(renameUrl, 262144, { timeoutMs: 30000 }),
    retrieve(stateDirectoryUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const renameText = cheerio.load(rename.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const directoryText = cheerio.load(directory.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const priceLinks = $pricing('a').map((_, node) => $pricing(node).attr('href')).get();
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes('location-name: South Shore University Hospital'));
  const safeEntry = entry?.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream'))
    .parsed.find(item => item.innerKind === 'json');
  if ([rename, directory, pricing, pointer, file].some(result => ![200, 206].includes(result.status))
      || !renameText.includes('formerly Southside Hospital in Bay Shore, NY')
      || !directoryText.includes('South Shore University Hospital')
      || !directoryText.includes('301 East Main Street')
      || !directoryText.includes('Bay Shore, NY 11706')
      || !priceLinks.includes(fileUrl)
      || !safeEntry?.includes('location-name: South Shore University Hospital')
      || !safeEntry.includes(`source-page-url: ${pricingUrl}`)
      || !safeEntry.includes(`mrf-url: ${fileUrl}`)
      || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'South Shore University Hospital'
      || parsed.mrfLocationName !== 'South Shore University Hospital'
      || parsed.mrfAddress !== '301 East Main St, Bay Shore, NY, 11706'
      || parsed.mrfLicenseState !== 'NY' || parsed.declaredLastUpdated !== '2026-03-31'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Southside rename, state directory, pricing, pointer, or ZIP header changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    first_party_rename_url: renameUrl, first_party_rename_sha256: rename.sha256,
    state_directory_url: stateDirectoryUrl, state_directory_sha256: directory.sha256,
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
    limitation: 'Only the first 262,144 bytes of a 31,000,915-byte ZIP were retained. The parsed JSON member header identifies the exact campus, but complete archive and file validity and legal compliance were not determined.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing Southside resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-south-shore-ny-alias-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace', evidence: {
    identity: 'corroborated', identity_basis: 'first-party-explicit-southside-rename-state-directory-exact-campus-pricing-page-root-pointer-json-archive-header',
    officialDomain: 'northwell.edu', identityPageUrl: renameUrl, identityPageSha256: rename.sha256,
    stateDirectoryUrl, stateDirectorySha256: directory.sha256,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: parsed.mrfLocationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'json',
    next_action: 'Validate the complete 31 MB ZIP and JSON member before any schema or legal-compliance conclusion.',
  }, evidence_run: 'southside-south-shore-explicit-rename-2026-09-16', reviewed_at: file.checkedAt,
  note: 'Northwell explicitly calls South Shore University Hospital formerly Southside Hospital in Bay Shore. New York State lists the current hospital at the roster 301 East Main Street campus. The first-party price page and live root pointer name the same ZIP, and its bounded JSON member header declares the exact campus, NY, 2026-03-31 and v3.0.0. This is bounded identity/pointer/archive evidence, not complete-file validation or a legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, sample_sha256: file.sha256,
    declared_date: parsed.declaredLastUpdated }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
