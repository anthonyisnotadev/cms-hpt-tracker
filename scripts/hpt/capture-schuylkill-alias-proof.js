'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '390030';
const historyUrl = 'https://www.lvhn.org/about-us';
const facilityUrl = 'https://www.lvhn.org/locations/lehigh-valley-hospital-schuylkill-s-jackson-street';
const pricingUrl = 'https://www.lvhn.org/get-price-quote';
const pointerUrl = 'https://lvhn.org/cms-hpt.txt';
const pointerFileUrl = 'https://lvhn.pt.panaceainc.com/MRFDownload/lvhn/Schuylkill';
const pageFileUrl = 'https://lvhn.pt.panaceainc.com/MRFDownload/lvhn/schuylkill';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'SCHUYLKILL MEDICAL CENTER - SOUTH JACKSON STREET'
      || roster.Address !== '420 SOUTH JACKSON STREET' || roster['City/Town'] !== 'POTTSVILLE'
      || roster.State !== 'PA' || roster['ZIP Code'] !== '17901'
      || base?.finding !== 'not-assessed-not-named-in-file' || base.pointer_url !== pointerUrl)
    throw new Error('Schuylkill roster or previous assessment changed');
  const [history, facility, pricing, pointer, file, pageFile] = await Promise.all([
    retrieve(historyUrl, 262144, { timeoutMs: 30000 }),
    retrieve(facilityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerFileUrl, 262144, { timeoutMs: 35000 }),
    retrieve(pageFileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const bodyText = result => cheerio.load(result.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const links = $pricing('a').map((_, node) => $pricing(node).attr('href')).get();
  const pointerEntries = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .filter(block => /location-name:\s*Lehigh Valley Hospital - Schuylkill/i.test(block));
  const safeEntries = pointerEntries.map(block => block.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/i.test(line)));
  const south = safeEntries.find(lines => lines.some(line => /location-name:\s*Lehigh Valley Hospital - Schuylkill S\. Jackson Street/i.test(line)));
  const north = safeEntries.find(lines => lines.some(line => /location-name:\s*Lehigh Valley Hospital - Schuylkill E\. Norwegian Street/i.test(line)));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream')).parsed
    .find(item => item.innerKind === 'json');
  if ([history, facility, pricing, pointer, file, pageFile].some(result => ![200, 206].includes(result.status))
      || !bodyText(history).includes('Schuylkill Medical Center–South Jackson Street')
      || !bodyText(history).includes('became LVH–Schuylkill S. Jackson Street')
      || !bodyText(facility).includes('Lehigh Valley Hospital–Schuylkill S. Jackson Street')
      || !bodyText(facility).includes('420 S. Jackson Street')
      || !bodyText(facility).includes('Pottsville, PA 17901')
      || !links.includes(pageFileUrl)
      || !south?.some(line => line.toLowerCase() === `mrf-url:${pointerFileUrl}`.toLowerCase())
      || !north?.some(line => line.toLowerCase() === `mrf-url:${pointerFileUrl}`.toLowerCase())
      || !south.some(line => line.toLowerCase() === `source-page-url: ${pricingUrl}`.toLowerCase())
      || file.body.length !== 262144 || file.sha256 !== pageFile.sha256
      || parsed?.mrfHospitalName !== 'LEHIGH VALLEY HOSPITAL - SCHUYLKILL'
      || !parsed.mrfLocationName.includes('Schuylkill S. Jackson Street')
      || !parsed.mrfAddress.includes('420 S Jackson St, Pottsville, PA 17901-3625')
      || !parsed.mrfAddress.includes('700 E Norwegian St, Pottsville, PA 17901-27100')
      || parsed.mrfLicenseState !== 'PA' || parsed.declaredLastUpdated !== '2026-07-01'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Schuylkill rename, campus, price link, pointer, or file metadata changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing Schuylkill resolution requires manual review');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    first_party_history_url: historyUrl, first_party_history_sha256: history.sha256,
    first_party_facility_url: facilityUrl, first_party_facility_sha256: facility.sha256,
    first_party_pricing_url: pricingUrl, first_party_pricing_sha256: pricing.sha256,
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_entries_without_contacts: safeEntries,
    pointer_file_url: pointerFileUrl, pricing_page_file_url: pageFileUrl,
    file_http_status: file.status, retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'), sample_sha256: file.sha256,
    page_file_sample_sha256: pageFile.sha256, archive_member_kind: parsed.innerKind,
    declared_hospital_name: parsed.mrfHospitalName, declared_location_names: parsed.mrfLocationName,
    declared_addresses: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    observed_at: file.checkedAt,
    limitation: 'Only the first 262,144 bytes of the shared file were retained. The pointer and page use differently cased paths with equal sampled bytes. Complete file validity and legal compliance were not determined.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-schuylkill-alias-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace', evidence: {
    identity: 'corroborated', identity_basis: 'first-party-historical-name-bridge-exact-south-jackson-campus-pricing-page-root-pointer-shared-json-header',
    officialDomain: 'lvhn.org', identityPageUrl: facilityUrl, identityPageSha256: facility.sha256,
    historyPageUrl: historyUrl, historyPageSha256: history.sha256,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: pointerFileUrl, fileSha256: file.sha256, http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: 'Lehigh Valley Hospital - Schuylkill S. Jackson Street',
    declared_hospital_name: parsed.mrfHospitalName, declared_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, facility_state: roster.State, file_kind: 'json',
    next_action: 'Validate the complete shared file and its campus-specific charge content before any schema or legal-compliance conclusion.',
  }, evidence_run: 'schuylkill-south-jackson-rename-shared-file-2026-09-16', reviewed_at: file.checkedAt,
  note: 'LVHN explicitly identifies Schuylkill Medical Center South Jackson Street as the former name of LVH Schuylkill S. Jackson Street at 420 S Jackson. Its price page and root pointer both name the shared Schuylkill file, with a case-only URL-path difference and matching sampled bytes. The bounded JSON header names both campuses, exact South Jackson address, PA, 2026-07-01 and v3.0.0. This is bounded source/identity evidence, not complete-file validation or a legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, sample_sha256: file.sha256, declared_date: parsed.declaredLastUpdated }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
