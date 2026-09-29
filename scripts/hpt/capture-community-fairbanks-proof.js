'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://ecommunity.com/cms-hpt.txt';
const locationUrl = 'https://www.ecommunity.com/locations/community-fairbanks-recovery-center';
const pricingUrl = 'https://www.ecommunity.com/central-pricing-office/list-of-standard-charges';
const fileUrl = 'https://media.ecommunity.com/PricingTransparency/Community_Hospital_Fairbanks.csv';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '150179');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '150179');
  const corpus = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv'), 'utf8'))
    .find(row => row.location_name === 'Community Fairbanks Recovery Center' && row.pointer_url === pointerUrl);
  if (!roster || roster['Facility Name'] !== 'FAIRBANKS'
      || roster.Address !== '8102 CLEARVISTA PARKWAY' || roster['City/Town'] !== 'INDIANAPOLIS'
      || roster.State !== 'IN' || roster['ZIP Code'] !== '46256'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.pointer_url !== pointerUrl || !corpus || corpus.mrf_url !== fileUrl
      || corpus.source_page_url !== pricingUrl)
    throw new Error('Fairbanks roster, prior assignment, or pointer corpus changed');
  const rawPointer = fs.readFileSync(path.join(root, corpus.raw_file));
  const pointerEntry = rawPointer.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(entry => entry.includes('location-name: Community Fairbanks Recovery Center'));
  if (sha256(rawPointer) !== corpus.pointer_sha256
      || !pointerEntry?.includes(`source-page-url: ${pricingUrl}`)
      || !pointerEntry.includes(`mrf-url: ${fileUrl}`)
      || !Number.isFinite(Date.parse(corpus.fetched_at)))
    throw new Error('Retained Fairbanks pointer artifact does not prove exact entry');
  const [pointerRetry, file] = await Promise.all([
    retrieve(pointerUrl, 4096, { timeoutMs: 20000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv');
  if (pointerRetry.status !== 403 || ![200, 206].includes(file.status)
      || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'Fairbanks Hospital, Inc.'
      || parsed.mrfAddress !== '8102 Clearvista Parkway, Indianapolis, IN 46256'
      || parsed.mrfLicenseState !== 'IN' || parsed.declaredLastUpdated !== '2025-12-16'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Fairbanks pointer retry or file metadata changed; reassess before applying');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn: '150179', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    current_brand: 'Community Fairbanks Recovery Center', first_party_location_url: locationUrl,
    first_party_pricing_url: pricingUrl,
    first_party_pages_reviewed_via: 'web search/open on 2026-09-16; direct client received HTTP 403',
    pointer_url: pointerUrl, retained_pointer_file: corpus.raw_file.replaceAll('\\', '/'),
    retained_pointer_sha256: corpus.pointer_sha256, retained_pointer_fetched_at: corpus.fetched_at,
    pointer_retry_http_status: pointerRetry.status, pointer_retry_sha256: pointerRetry.sha256,
    pointer_browser_observation: 'ERR_BLOCKED_BY_CLIENT on 2026-09-16; not a pointer-absence finding',
    pointer_location_name: corpus.location_name, file_url: fileUrl,
    file_http_status: file.status, retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'), sample_sha256: file.sha256,
    declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    observed_at: file.checkedAt,
    limitation: 'The root pointer was retrieved and hashed on 2026-09-07, but a direct 2026-09-16 retry got HTTP 403 and the browser got ERR_BLOCKED_BY_CLIENT. The first-party pricing page currently links the same file. Only 262,144 file bytes were retained; complete-file validity and legal compliance were not determined.',
  };
  const evidence = {
    identity: 'corroborated', identity_basis: 'recent-cached-root-pointer-current-first-party-page-and-exact-indianapolis-csv-header',
    officialDomain: 'ecommunity.com', identityPageUrl: locationUrl,
    sourcePageUrl: pricingUrl, pointerUrl, pointerSha256: corpus.pointer_sha256,
    pointerFetchedAt: corpus.fetched_at, pointerRetryHttpStatus: pointerRetry.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status,
    checked_at: file.checkedAt, date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: corpus.location_name, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'csv',
    next_action: 'Recheck the exact root pointer after the client access restriction changes; preserve the September 7 pointer and current first-party page/file evidence. Validate the complete CSV before a legal or schema-compliance conclusion.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === '150179')) throw new Error('Existing Fairbanks resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-community-fairbanks-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn: '150179', base, action: 'replace', evidence,
    evidence_run: 'community-fairbanks-cached-pointer-current-file-2026-09-16', reviewed_at: file.checkedAt,
    note: 'The roster Fairbanks campus at 8102 Clearvista Parkway is now branded Community Fairbanks Recovery Center. The retained September 7 root pointer names that center and links its official pricing page and CSV. The September 16 pricing page still links the CSV; fresh bounded file bytes identify Fairbanks Hospital, Inc. at the exact campus, Indiana, 2025-12-16, and v3.0.0. A direct pointer retry returned 403 and the browser was blocked, neither of which proves pointer absence. This is a dated pointer/page/header observation, not full-file validation or a legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '150179', pointer_fetched_at: corpus.fetched_at,
    pointer_retry_status: pointerRetry.status, sample_sha256: file.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
