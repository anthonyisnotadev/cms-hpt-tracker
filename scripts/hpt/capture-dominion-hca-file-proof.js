'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '494023';
const pointerUrl = 'https://hcavirginia.com/cms-hpt.txt';
const pricingUrl = 'https://www.hcavirginia.com/patient-resources/patient-financial-resources/pricing-transparency-cms-required-file-of-standard-charges';
const identityUrl = 'https://www.hcavirginia.com/locations/dominion-hospital/for-patients/virginia-pricing-transparency';
const fileUrl = 'https://stctrprodsnsvc00455826e6.blob.core.windows.net/pt-final-posting-files/62-1410313_DOMINION-HOSPITAL_standardcharges.json?si=dpx-pt-json-access-policy&spr=https&sv=2026-02-06&sr=c&sig=ks%2BgfAjyEHlZmeP2PYJ%2F9NpMuCoRStjTb2bhIy9Y6LM%3D';
const pointerSha = '2c86c37e9102b7a1cef5b731a1a07cf5355bdc3e1caf161d9deec80ff0e58ea7';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  const pointerState = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/crawl-state.json'), 'utf8'));
  const target = pointerState.targets[`url:${pointerUrl}`];
  if (!target || target.sha256 !== pointerSha) throw new Error('HCA pointer artifact changed');
  const pointerText = fs.readFileSync(path.join(root, target.rawFile), 'utf8');
  const pointerLocations = [...pointerText.matchAll(/^location-name:\s*(.+)$/gm)].map(match => match[1].trim());
  if (pointerLocations.some(name => /Dominion/i.test(name))) throw new Error('Dominion unexpectedly appears in pointer');
  if (roster?.['Facility Name'] !== 'DOMINION HOSPITAL' || roster.Address !== '2960 SLEEPY HOLLOW ROAD'
      || roster['City/Town'] !== 'FALLS CHURCH' || roster.State !== 'VA'
      || base?.finding !== 'not-assessed-not-named-in-file') throw new Error('Dominion roster or base assessment changed');
  const file = await retrieve(fileUrl, 262144, { timeoutMs: 45000 });
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/json')).parsed
    .find(item => item.innerKind === 'json');
  if (![200, 206].includes(file.status) || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'DOMINION HOSPITAL'
      || parsed.mrfLocationName !== 'DOMINION HOSPITAL'
      || parsed.mrfAddress !== '2960 SLEEPY HOLLOW ROAD, FALLS CHURCH, VA, 22044'
      || parsed.mrfLicenseState !== 'VA' || parsed.declaredLastUpdated !== '2026-03-01'
      || parsed.cmsVersion !== '3.0.0') throw new Error(`Dominion file metadata changed: HTTP ${file.status}, SHA ${file.sha256}`);
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Dominion already has a reviewed resolution');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State,
    identity_page_url: identityUrl, pricing_page_url: pricingUrl,
    pointer_url: pointerUrl, pointer_sha256: pointerSha, pointer_observed_at: target.fetchedAt,
    pointer_final_url: target.finalUrl, pointer_lists_facility: false, pointer_location_names: pointerLocations,
    file_url_origin_path: new URL(fileUrl).origin + new URL(fileUrl).pathname,
    signed_file_url_sha256: sha(fileUrl), signed_file_url_withheld: true,
    file_http_status: file.status, retained_bytes: file.body.length, sample_sha256: file.sha256,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    observed_at: file.checkedAt,
    limitation: 'The exact JSON was discovered in the official HCA Azure storage namespace using the Dominion EIN/name convention after the shared HCA page and root pointer omitted Dominion. Only the first 262,144 bytes were retained; complete-file validity and legal compliance were not determined. The signed URL is withheld from the public tracker.'
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-dominion-hca-file-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace-observation', evidence: {
    identity: 'corroborated', identity_basis: 'official-hca-storage-json-exact-ein-name-address-state-and-current-metadata',
    officialDomain: 'hcavirginia.com', identityPageUrl: identityUrl, sourcePageUrl: pricingUrl,
    pointerUrl, pointerSha256: pointerSha, pointerHttpStatus: 206, pointerListsFacility: false,
    pointerLocationNames: pointerLocations, url: fileUrl, fileSha256: file.sha256,
    http_status: file.status, checked_at: file.checkedAt, date: parsed.declaredLastUpdated,
    version: parsed.cmsVersion, location_name: parsed.mrfLocationName,
    declared_hospital_name: parsed.mrfHospitalName, declared_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, facility_state: roster.State, file_kind: 'json',
    pointerIssue: 'root-pointer-omits-facility-specific-entry',
    observedFinding: 'root-pointer-omits-facility-official-storage-file-found',
    next_action: 'Publisher should add the Dominion entry and exact file URL to cms-hpt.txt; then recheck pointer linkage and validate complete-file usability. Do not treat the page/publisher storage discovery as pointer-linked or a legal compliance conclusion.'
  }, evidence_run: 'dominion-hca-official-storage-file-2026-09-18', reviewed_at: file.checkedAt,
  note: 'The HCA root pointer and shared pricing page omitted Dominion, but the official HCA Azure storage namespace contains an exact EIN/name JSON whose bounded CMS header matches Dominion Hospital at the Falls Church roster address, VA, 2026-03-01 and v3.0.0. This is a page/publisher-storage file observation, not pointer linkage or full-file validation.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, sample_sha256: file.sha256, declared_date: parsed.declaredLastUpdated, pointer_lists_facility: false }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
