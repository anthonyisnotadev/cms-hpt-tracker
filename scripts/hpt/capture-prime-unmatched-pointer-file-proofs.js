'use strict';

// Resolve only the unmatched Prime pointer entries with independent, bounded
// first-party page, exact root pointer, and selected file-header observations.
const fs = require('node:fs');
const path = require('node:path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { parsePointer } = require('./lib/parse');
const { csvToObjects, normalizeName } = require('./lib/util');
const { strongAddressAgreement } = require('./lib/mrf-header-match');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const cases = [
  ['050580', 'https://lapalmaintercommunityhospital.com/contact-us/', 'La Palma Intercommunity Hospital', '7901'],
  ['050709', 'https://dvmc.com/contact-us/', 'Desert Valley Hospital', '16850'],
  ['050764', 'https://er-scheduling.shastaregional.com/en', 'Shasta Regional Medical Center', '1100'],
  ['150183', 'https://monroehospital.com/contact-us/', 'Monroe Hospital', '4011'],
  ['170009', 'https://stjohnleavenworth.com/contact-us/', 'Saint John Hospital', '3500'],
  ['290009', 'https://saintmarysreno.com/', 'Saint Mary', '235'],
  ['450855', 'https://er-scheduling.harlingenmedicalcenter.com/en', 'Harlingen Medical Center', '5501']
];
function pageSupportsCampus(html, name, streetNumber, city, zip) {
  if (!html.toLowerCase().includes(name.toLowerCase())) return false;
  const lower = html.toLowerCase();
  const number = String(streetNumber).toLowerCase();
  for (let at = lower.indexOf(number); at >= 0; at = lower.indexOf(number, at + number.length)) {
    const nearby = lower.slice(at, at + 420);
    if (nearby.includes(city.toLowerCase()) && nearby.includes(String(zip))) return true;
  }
  return false;
}

async function observe(config, inventory, roster, base) {
  const [ccn, identityUrl, identityName, streetNumber] = config;
  const caseRow = inventory.find(row => row.ccn === ccn);
  const hospital = roster.get(ccn), standing = base.get(ccn);
  if (!caseRow || caseRow.review_priority !== '1-different-file-pointer-match-unresolved'
      || !hospital || !standing || standing.finding !== 'compliant-observed'
      || standing.mrf_url !== caseRow.standing_mrf_url)
    throw new Error(`Case ${ccn} no longer matches the guarded cohort`);
  const pointerUrl = caseRow.pointer_corpus_checked_url;
  const fileUrl = caseRow.observed_mrf_url;
  const pointerHost = new URL(pointerUrl).hostname;
  const identityHost = new URL(identityUrl).hostname;
  if (!(identityHost === pointerHost || identityHost.endsWith('.' + pointerHost)))
    throw new Error(`Identity page for ${ccn} is not on the hospital host`);
  const [pointer, page, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 1048576, { timeoutMs: 35000 })
  ]);
  const entry = parsePointer(pointer.body.toString('utf8')).entries.find(item =>
    normalizeName(item.locationName) === normalizeName(hospital['Facility Name'])
      && item.mrfUrls?.includes(fileUrl));
  const html = page.body.toString('utf8');
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/json')).parsed
    .find(item => item.innerKind === 'json');
  if (![200, 206].includes(pointer.status) || ![200, 206].includes(page.status)
      || ![200, 206].includes(file.status) || !entry || file.body.length < 65536
      || pointer.sha256 !== caseRow.pointer_corpus_sha256
      || !pageSupportsCampus(html, identityName, streetNumber, hospital['City/Town'], hospital['ZIP Code'])
      || normalizeName(parsed?.mrfHospitalName) !== normalizeName(hospital['Facility Name'])
      || !strongAddressAgreement(hospital.Address, parsed?.mrfAddress)
      || !String(parsed.mrfAddress).toUpperCase().includes(hospital['City/Town'])
      || !String(parsed.mrfAddress).includes(hospital['ZIP Code'])
      || parsed.mrfLicenseState !== hospital.State
      || parsed.declaredLastUpdated !== caseRow.declared_last_updated
      || parsed.cmsVersion !== caseRow.literal_template_version)
    throw new Error(`Exact page/pointer/file gate failed for ${ccn}: HTTP ${page.status}/${pointer.status}/${file.status}`);
  return { ccn, hospital, standing, identityUrl, pointerUrl, fileUrl,
    pointer, page, file, entry, parsed };
}

async function main() {
  const inventory = JSON.parse(fs.readFileSync(path.join(audit, 'template-version-discrepancies.json'), 'utf8')).records;
  const roster = new Map(csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .map(row => [row['Facility ID'], row]));
  const base = new Map(csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .map(row => [row.ccn, row]));
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const priorResolutions = new Set(ledger.map(row => row.ccn));
  const accepted = [], rejected = [];
  for (const config of cases) {
    if (priorResolutions.has(config[0])) throw new Error(`Existing reviewed resolution ${config[0]}`);
    try { accepted.push(await observe(config, inventory, roster, base)); }
    catch (error) { rejected.push({ ccn: config[0], reason: error.message }); }
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const save = response => {
    const target = path.join(sampleDir, `${response.sha256}.bin`);
    fs.writeFileSync(target, response.body);
    return path.relative(root, target).replaceAll('\\', '/');
  };
  const proofs = accepted.map(item => {
    const { ccn, hospital, standing, identityUrl, pointerUrl, fileUrl, pointer, page, file, entry, parsed } = item;
    ledger.push({ ccn, base: standing, action: 'replace-observation', evidence: {
      identity: 'corroborated', identity_basis: 'first-party-campus-page-exact-root-pointer-and-file-name-address-state',
      officialDomain: new URL(pointerUrl).hostname, pointerUrl, pointerSha256: pointer.sha256,
      pointerHttpStatus: pointer.status, url: fileUrl, fileSha256: file.sha256,
      identityPageUrl: identityUrl, identityPageSha256: page.sha256,
      http_status: file.status, checked_at: file.checkedAt,
      date: parsed.declaredLastUpdated, version: parsed.cmsVersion, expected_version: '3.0.0',
      location_name: entry.locationName, declared_hospital_name: parsed.mrfHospitalName,
      declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
      facility_state: hospital.State, file_kind: 'json', observedFinding: 'mrf-template-version-noncanonical',
      next_action: 'Validate the complete September file and recheck whether the literal 3.0 identifier is corrected.'
    }, evidence_run: `prime-unmatched-pointer-file-${ccn}-2026-09-17`, reviewed_at: file.checkedAt,
    note: 'A current first-party campus page, exact hospital root pointer and bounded file header agree on this CCN. The selected file declares literal 3.0; this is metadata review, not a full-file or legal-compliance verdict.' });
    return { ccn, roster_name: hospital['Facility Name'], roster_address: hospital.Address,
      roster_city: hospital['City/Town'], roster_state: hospital.State, roster_zip: hospital['ZIP Code'],
      identity_page_url: identityUrl, identity_page_http_status: page.status,
      identity_page_observed_at: page.checkedAt, identity_page_sha256: page.sha256,
      identity_page_retained_file: save(page),
      pointer_url: pointerUrl, pointer_http_status: pointer.status,
      pointer_observed_at: pointer.checkedAt, pointer_sha256: pointer.sha256,
      pointer_retained_file: save(pointer), pointer_location_name: entry.locationName,
      pointer_mrf_url: fileUrl, file_http_status: file.status, file_observed_at: file.checkedAt,
      file_retained_bytes: file.body.length, file_sample_sha256: file.sha256,
      file_retained_sample: save(file), declared_hospital_name: parsed.mrfHospitalName,
      declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress,
      declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
      declared_version: parsed.cmsVersion, displaced_file_url: standing.mrf_url,
      limitation: 'Identity-matched first-party page, exact root pointer and bounded file prefix, not complete-file validity or legal compliance.' };
  });
  const proofPath = path.join(audit, 'reconciliation-prime-unmatched-pointer-file-proofs.json');
  fs.writeFileSync(proofPath, JSON.stringify({ generated_at: new Date().toISOString(),
    successful_ccns: proofs.map(row => row.ccn), rejected, records: proofs }, null, 2) + '\n');
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ accepted: proofs.map(row => row.ccn), rejected }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { pageSupportsCampus };
