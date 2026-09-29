'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const cheerio = require('cheerio');
const { retrieve, parsePayload, zipEntries } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '170006';
const identityUrl = 'https://www.mercy.net/practice/mercy-hospital-pittsburg/';
const pricingUrl = 'https://www.mercy.net/forms/items-and-services-files/';
const pointerUrl = 'https://mercy.net/cms-hpt.txt';
const fileUrl = 'https://www.mercy.net/content/dam/mercy/en/web-assets/charge-files/480543778_mercy-hospital-pittsburg-inc_standardcharges.zip';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'MERCY HOSPITAL PITTSBURG, INC'
      || roster.Address !== '1 MT CARMEL WAY' || roster['City/Town'] !== 'PITTSBURG'
      || roster.State !== 'KS' || roster['ZIP Code'] !== '66762'
      || base?.finding !== 'not-assessed-not-named-in-file'
      || base.pointer_url !== 'https://healthcare.ascension.org/-/media/Healthcare/cms-hpt.txt')
    throw new Error('Pittsburg roster or prior assessment changed');
  const [identity, pricing, pointer, file] = await Promise.all([
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes('location-name: Mercy Hospital Pittsburg'));
  const safeEntry = entry?.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/zip')).parsed
    .find(item => item.innerKind === 'csv');
  const member = zipEntries(file.body).find(item => item.name === parsed?.member);
  const inflated = member && zlib.inflateRawSync(file.body.subarray(member.start),
    { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8');
  const firstLines = inflated?.split(/\r?\n/).slice(0, 2) || [];
  if ([identity, pricing, pointer, file].some(result => ![200, 206].includes(result.status))
      || !identityText.includes('Mercy Hospital Pittsburg')
      || !identityText.includes('1 Mt Carmel Way') || !identityText.includes('Pittsburg, KS 66762')
      || !safeEntry?.includes('location-name: Mercy Hospital Pittsburg')
      || !safeEntry.includes(`source-page-url: ${pricingUrl}`)
      || !safeEntry.includes(`mrf-url: ${fileUrl}`)
      || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'Mercy Hospital Pittsburg Inc'
      || parsed.mrfLocationName !== 'Mercy Hospital Pittsburg Inc'
      || parsed.mrfAddress !== '1 MT Carmel Way Pittsburg KS 66762'
      || parsed.mrfLicenseState !== 'OK' || parsed.declaredLastUpdated !== '2026-06-09'
      || parsed.cmsVersion !== '3.0.0'
      || !firstLines[0].includes('license_number | OK')
      || !firstLines[1].includes('1 MT Carmel Way Pittsburg KS 66762,H-019-002,1639921430'))
    throw new Error('Pittsburg identity, pointer, ZIP member, or state conflict changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing Pittsburg resolution requires manual review');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    first_party_identity_url: identityUrl, first_party_identity_sha256: identity.sha256,
    source_page_url: pricingUrl, source_page_sha256: pricing.sha256,
    source_page_file_link_observed: false,
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_entry_without_contacts: safeEntry,
    file_url: fileUrl, file_http_status: file.status,
    file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, archive_member: parsed.member,
    declared_hospital_name: parsed.mrfHospitalName, declared_address: parsed.mrfAddress,
    facility_state: roster.State, declared_license_state_column: 'license_number | OK',
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, observed_at: file.checkedAt,
    limitation: 'The Mercy pointer and first-party campus page are current, but its named pricing page did not expose the ZIP link in the bounded HTML response. Only 262144 bytes of a 10241907-byte ZIP were retained. The CSV member header names license_number | OK for a KS hospital; publisher clarification and complete-file validation are required. No legal-compliance verdict.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-mercy-pittsburg-state-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace-observation', evidence: {
    identity: 'corroborated', identity_basis: 'first-party-mercy-pittsburg-exact-campus-root-pointer-zip-csv-header-with-license-state-conflict',
    officialDomain: 'mercy.net', identityPageUrl: identityUrl, identityPageSha256: identity.sha256,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: 'Mercy Hospital Pittsburg', declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'zip',
    observedFinding: 'mrf-license-state-field-conflicts-facility',
    next_action: 'Obtain publisher confirmation/correction of the OK license-number column for this Kansas facility; verify the pricing page link and complete ZIP/member before any clean-file or legal-compliance conclusion.',
  }, evidence_run: 'mercy-pittsburg-ascension-domain-state-conflict-2026-09-16', reviewed_at: file.checkedAt,
  note: 'The earlier Ascension pointer did not name this hospital. The current Mercy hospital page identifies the 1 Mt Carmel Way, Pittsburg KS campus, and Mercy\'s root pointer explicitly names Mercy Hospital Pittsburg and a ZIP. Its bounded CSV member header identifies that campus, 2026-06-09 and v3.0.0, but labels the license-number field OK rather than KS. The pointer-named pricing page did not expose a file link in the bounded HTML response. This is a documented publisher metadata conflict, not a clean verification or legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, sample_sha256: file.sha256,
    observed_finding: 'mrf-license-state-field-conflicts-facility' }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
