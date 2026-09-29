'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const identityUrl = 'https://www.logan.org/logan-health-conrad/';
const pricingUrl = 'https://www.logan.org/pay-bill/price-transparency/';
const pointerUrl = 'https://logan.org/cms-hpt.txt';
const sourceUrl = 'https://hospitalpricedisclosure.com/default.aspx?pi=YI*_*B*_*wvXdFlgmQNXvicF2w*-*';
const fileUrl = 'https://hospitalpricedisclosure.com/download.aspx?pi=YI*_*B*_*wvXdFlgmQNXvicF2w*-*';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '271324');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '271324');
  if (!roster || roster['Facility Name'] !== 'PONDERA MEDICAL CENTER'
      || roster.Address !== '805 SUNSET BLVD' || roster['City/Town'] !== 'CONRAD'
      || roster.State !== 'MT' || roster['ZIP Code'] !== '59425'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.pointer_url !== pointerUrl)
    throw new Error('Conrad roster or previous assignment changed');
  const [identity, pricing, pointer, file] = await Promise.all([
    retrieve(identityUrl, 262144, { timeoutMs: 25000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 25000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const pricingText = $pricing('body').text().replace(/\s+/g, ' ');
  const pricingLinks = $pricing('a').map((_, element) => $pricing(element).attr('href')).get();
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes('location-name: Logan Health - Conrad'));
  const safeEntry = entry?.split(/\r?\n/).filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream'))
    .parsed.find(item => item.innerKind === 'json');
  if (![200, 206].includes(identity.status)
      || !identityText.includes('formerly Pondera Medical Center')
      || !identityText.includes('805 Sunset Blvd')
      || ![200, 206].includes(pricing.status)
      || !pricingText.includes('Logan Health – Conrad')
      || !pricingLinks.includes(fileUrl)
      || ![200, 206].includes(pointer.status)
      || !safeEntry?.includes('location-name: Logan Health - Conrad')
      || !safeEntry.includes(`source-page-url: ${sourceUrl}`)
      || !safeEntry.includes(`mrf-url: ${fileUrl}`)
      || ![200, 206].includes(file.status) || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'Logan Health - Conrad'
      || parsed.mrfLocationName !== 'Logan Health - Conrad'
      || parsed.mrfAddress !== '805 Sunset Blvd, Conrad, MT 59425'
      || parsed.mrfLicenseState !== 'MT' || parsed.declaredLastUpdated !== '2026-04-01'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Conrad rename, pricing, pointer, or JSON metadata changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn: '271324', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    current_name: 'Logan Health - Conrad',
    first_party_identity_url: identityUrl, first_party_identity_sha256: identity.sha256,
    first_party_pricing_url: pricingUrl, first_party_pricing_sha256: pricing.sha256,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_entry_without_contacts: safeEntry, pointer_location_name: 'Logan Health - Conrad',
    pointer_source_portal_url: sourceUrl, file_url: fileUrl, file_http_status: file.status,
    file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, observed_at: file.checkedAt,
    limitation: 'Only 262,144 JSON bytes were retained. Identity, direct pointer and first-party price-page linkage, and file header were corroborated; complete-file validity and legal compliance were not determined.',
  };
  const evidence = {
    identity: 'corroborated', identity_basis: 'first-party-explicit-pondera-rename-conrad-campus-pricing-page-root-pointer-json-header',
    officialDomain: 'logan.org', identityPageUrl: identityUrl, identityPageSha256: identity.sha256,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status,
    checked_at: file.checkedAt, date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: parsed.mrfLocationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'json',
    next_action: 'Validate the complete current JSON before any schema or legal-compliance conclusion.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === '271324')) throw new Error('Existing Conrad resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-logan-conrad-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn: '271324', base, action: 'replace', evidence,
    evidence_run: 'logan-conrad-pondera-rename-2026-09-16', reviewed_at: file.checkedAt,
    note: 'Logan Health explicitly identifies Logan Health - Conrad as formerly Pondera Medical Center at the roster campus, 805 Sunset Boulevard. Its first-party pricing page and live root pointer name the same downloadable JSON. Bounded JSON bytes declare the exact Conrad campus, Montana, 2026-04-01 and v3.0.0. This is a pointer/page/header observation, not complete-file validation or a legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '271324', pointer_sha256: pointer.sha256,
    sample_sha256: file.sha256, declared_date: parsed.declaredLastUpdated }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
