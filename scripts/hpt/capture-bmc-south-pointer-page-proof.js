'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const renameUrl = 'https://www.bmchealthsystem.org/new-name-faq';
const pricingUrl = 'https://www.bmchealthsystem.org/bmc-south/pricing-and-estimates';
const pointerUrl = 'https://bmchealthsystem.org/cms-hpt.txt';
const pointerFileUrl = 'https://www.bmchealthsystem.org/wp-content/uploads/272473728_BostonMedicalCenterSouth_standardcharges.csv.zip';
const pageFileUrl = 'https://www.bmchealthsystem.org/wp-content/uploads/2025/04/272473728_BostonMedicalCenterSouth_standardcharges.csv.zip';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '220111');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '220111');
  if (!roster || roster['Facility Name'] !== 'GOOD SAMARITAN MEDICAL CENTER'
      || roster.Address !== '235 NORTH PEARL STREET' || roster['City/Town'] !== 'BROCKTON'
      || roster.State !== 'MA' || roster['ZIP Code'] !== '02301'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.pointer_url !== pointerUrl)
    throw new Error('BMC South roster or original assignment changed');
  const [rename, pricing, pointer, pointerFile, pageFile] = await Promise.all([
    retrieve(renameUrl, 262144, { timeoutMs: 25000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 25000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 25000 }),
    retrieve(pointerFileUrl, 262144, { timeoutMs: 35000 }),
    retrieve(pageFileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const renameText = cheerio.load(rename.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const pricingText = $pricing('body').text().replace(/\s+/g, ' ');
  const pageLink = $pricing('a').map((_, element) => ({
    text: $pricing(element).text().trim(), href: $pricing(element).attr('href'),
  })).get().find(link => /Download the Boston Medical Center - South machine readable file/i.test(link.text));
  const pointerEntry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(entry => entry.startsWith('location-name: Boston Medical Center South\n'));
  const pointerParsed = (await parsePayload(pointerFile.body, pointerFile.headers['content-type'] || 'application/zip'))
    .parsed.find(item => item.innerKind === 'csv');
  const pageParsed = (await parsePayload(pageFile.body, pageFile.headers['content-type'] || 'application/zip'))
    .parsed.find(item => item.innerKind === 'csv');
  if (![200, 206].includes(rename.status)
      || !renameText.includes('Good Samaritan Medical Center is now Boston Medical Center – South')
      || ![200, 206].includes(pricing.status)
      || !/235 North Pearl St\.? Brockton, MA 02301/.test(pricingText)
      || pageLink?.href !== pageFileUrl
      || ![200, 206].includes(pointer.status)
      || !pointerEntry?.includes('source-page-url: https://www.bmchealthsystem.org/pricing-and-estimates')
      || !new RegExp(`mrf-url:\\s+${pointerFileUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(pointerEntry)
      || ![200, 206].includes(pointerFile.status) || pointerFile.body.length !== 262144
      || ![200, 206].includes(pageFile.status) || pageFile.body.length !== 262144
      || pointerParsed?.mrfHospitalName !== 'Boston Medical Center South'
      || pointerParsed.mrfAddress !== '235 North Pearl Street, Brockton MA 02301'
      || pointerParsed.mrfLicenseState !== 'MA'
      || pointerParsed.declaredLastUpdated !== '2026-03-13'
      || pointerParsed.cmsVersion !== '3.0.0'
      || pageParsed?.mrfHospitalName !== 'BMC Community Hospital Corporation d/b/a Good Samaritan Medical Center'
      || pageParsed.mrfAddress !== pointerParsed.mrfAddress
      || pageParsed.mrfLicenseState !== 'MA'
      || pageParsed.declaredLastUpdated !== '2025-01-15'
      || pageParsed.cmsVersion !== '2.0.0')
    throw new Error('BMC South rename, pointer, page link, or distinct file metadata changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const pointerSample = path.join(sampleDir, `${pointerFile.sha256}.bin`);
  const pageSample = path.join(sampleDir, `${pageFile.sha256}.bin`);
  fs.writeFileSync(pointerSample, pointerFile.body);
  fs.writeFileSync(pageSample, pageFile.body);
  const proof = {
    ccn: '220111', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    current_hospital_name: 'Boston Medical Center South',
    first_party_rename_url: renameUrl, first_party_rename_sha256: rename.sha256,
    first_party_pricing_url: pricingUrl, first_party_pricing_sha256: pricing.sha256,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_location_name: 'Boston Medical Center South',
    pointer_file_url: pointerFileUrl, pointer_file_http_status: pointerFile.status,
    pointer_file_retained_sample: path.relative(root, pointerSample).replaceAll('\\', '/'),
    pointer_file_sample_sha256: pointerFile.sha256,
    pointer_file_declared_name: pointerParsed.mrfHospitalName,
    pointer_file_declared_address: pointerParsed.mrfAddress,
    pointer_file_declared_state: pointerParsed.mrfLicenseState,
    pointer_file_declared_date: pointerParsed.declaredLastUpdated,
    pointer_file_declared_version: pointerParsed.cmsVersion,
    pricing_page_file_url: pageFileUrl, pricing_page_file_http_status: pageFile.status,
    pricing_page_file_retained_sample: path.relative(root, pageSample).replaceAll('\\', '/'),
    pricing_page_file_sample_sha256: pageFile.sha256,
    pricing_page_file_declared_name: pageParsed.mrfHospitalName,
    pricing_page_file_declared_address: pageParsed.mrfAddress,
    pricing_page_file_declared_state: pageParsed.mrfLicenseState,
    pricing_page_file_declared_date: pageParsed.declaredLastUpdated,
    pricing_page_file_declared_version: pageParsed.cmsVersion,
    retained_bytes_per_file: 262144, observed_at: pointerFile.checkedAt,
    limitation: 'Only 262,144 bytes per ZIP were retained. The current root pointer and facility pricing page serve distinct identity-matched files; complete-file validity and legal compliance were not determined.',
  };
  const evidence = {
    identity: 'corroborated', identity_basis: 'first-party-explicit-rename-exact-brockton-street-pointer-and-both-file-headers',
    officialDomain: 'bmchealthsystem.org', identityPageUrl: renameUrl, identityPageSha256: rename.sha256,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: pointerFileUrl, fileSha256: pointerFile.sha256, http_status: pointerFile.status,
    checked_at: pointerFile.checkedAt, date: pointerParsed.declaredLastUpdated,
    version: pointerParsed.cmsVersion, location_name: pointerParsed.mrfLocationName,
    declared_hospital_name: pointerParsed.mrfHospitalName,
    declared_address: pointerParsed.mrfAddress, declared_license_state: pointerParsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'csv.zip',
    pageMrfUrl: pageFileUrl, pageMrfSha256: pageFile.sha256,
    pageMrfHttpStatus: pageFile.status, pageMrfDate: pageParsed.declaredLastUpdated,
    pageMrfVersion: pageParsed.cmsVersion,
    observedFinding: 'pricing-page-links-older-mrf-than-pointer',
    next_action: 'Ask the publisher to align the BMC South pricing-page download with its newer root-pointer file, then independently verify complete-file usability. Do not substitute the 2025 page ZIP for the 2026 pointer ZIP.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === '220111')) throw new Error('Existing BMC South resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-bmc-south-pointer-page-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn: '220111', base, action: 'replace-observation', evidence,
    evidence_run: 'bmc-south-rename-pointer-page-mismatch-2026-09-16', reviewed_at: pointerFile.checkedAt,
    note: 'BMC Health System explicitly renamed Good Samaritan Medical Center in Brockton to BMC South. Its current root pointer links a 2026-03-13 v3.0.0 ZIP matching the exact campus; its BMC South pricing page still links a separate 2025-01-15 v2.0.0 ZIP for the same campus. Both byte samples are retained. This is a factual route/version divergence, not a full-file or legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '220111', pointer_file_sha256: pointerFile.sha256,
    page_file_sha256: pageFile.sha256, pointer_date: pointerParsed.declaredLastUpdated,
    page_date: pageParsed.declaredLastUpdated }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
