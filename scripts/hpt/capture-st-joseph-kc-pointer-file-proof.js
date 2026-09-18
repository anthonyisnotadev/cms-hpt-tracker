'use strict';

// One bounded file repeat retains bytes from the initial diagnostic read.
// The September pointer bytes are already cached and hash-corroborated.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { parsePointer } = require('./lib/parse');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '260085';
const pointerUrl = 'https://stjosephkc.com/cms-hpt.txt';
const fileUrl = 'https://stjosephkc.com/wp-content/uploads/2026/09/53711_StJosephMedicalCenter_standardcharges.json';
const oldFileUrl = 'https://www.vmfh.org/content/dam/vmfhorg/documents/price-transparency/910565546-1518912609_harrison-medical-center_standardcharges.json';
const pointerSha = '014f37c14a6989fc7c4658d04907a9c01485263aa5a43a023bdfea568cc5c9d7';
const sampleSha = '319b66dad6803dd89134e43447aad076b2bbf5d454e2dfbc138d8d466d53dc3c';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  const state = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/crawl-state.json'), 'utf8'));
  const target = state.targets[`url:${pointerUrl}`];
  const pointerBytes = target?.rawFile && fs.readFileSync(path.join(root, target.rawFile));
  const entry = pointerBytes && parsePointer(pointerBytes.toString('utf8')).entries
    .find(item => item.locationName === 'St. Joseph Medical Center' && item.mrfUrls?.includes(fileUrl));
  const header = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/hpt/nationwide-verification/mrf-headers.csv'), 'utf8'))
    .find(row => row.mrf_url === oldFileUrl);
  if (roster?.['Facility Name'] !== 'ST JOSEPH MEDICAL CENTER'
      || roster.Address !== '1000 CARONDELET DR' || roster.State !== 'MO'
      || base?.finding !== 'compliant-observed' || base.mrf_url !== oldFileUrl
      || !pointerBytes || sha(pointerBytes) !== pointerSha || target.sha256 !== pointerSha
      || !entry || !header || header.mrf_license_state !== 'WA'
      || !/St\. Michael Medical Center/i.test(header.mrf_location_name || ''))
    throw new Error('St Joseph KC roster, prior-file conflict, or cached exact pointer changed');
  const file = await retrieve(fileUrl, 1048576, { timeoutMs: 35000 });
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/json')).parsed
    .find(item => item.innerKind === 'json');
  if (![200, 206].includes(file.status) || file.body.length !== 1048576 || file.sha256 !== sampleSha
      || parsed?.mrfHospitalName !== 'St Joseph Medical Center'
      || parsed.mrfAddress !== '1000 Carondelet Drive Kansas City, MO  64114'
      || parsed.mrfLicenseState !== 'MO' || parsed.declaredLastUpdated !== '2026-03-17'
      || parsed.cmsVersion !== '3.0')
    throw new Error(`St Joseph KC file evidence changed: HTTP ${file.status}, SHA ${file.sha256}`);
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('St Joseph KC already has a reviewed resolution');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${sampleSha}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State,
    source_page_url: 'https://stjosephkc.com/patients-visitors/financial-assistance/',
    pointer_url: pointerUrl, pointer_raw_file: target.rawFile.replaceAll('\\', '/'),
    pointer_sha256: pointerSha, pointer_corpus_observed_at: target.fetchedAt,
    pointer_later_recheck_http_status: 206, pointer_later_recheck_observed_at: '2026-09-17T04:07:55.557Z',
    pointer_location_name: entry.locationName, pointer_mrf_url: fileUrl,
    file_url: fileUrl, file_http_status: file.status, file_observed_at: file.checkedAt,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: sampleSha, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, expected_version: '3.0.0',
    displaced_file_url: oldFileUrl, displaced_file_declared_state: header.mrf_license_state,
    displaced_file_declared_location: header.mrf_location_name,
    limitation: 'Cached exact first-party pointer and bounded file prefix establish this Missouri campus and declared metadata, not full-file validity or legal compliance.'
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-st-joseph-kc-pointer-file-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace-observation', evidence: {
    identity: 'corroborated', identity_basis: 'exact-missouri-root-pointer-and-file-name-address-state',
    officialDomain: 'stjosephkc.com', pointerUrl, pointerSha256: pointerSha,
    pointerHttpStatus: 206, url: fileUrl, fileSha256: sampleSha,
    http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion, expected_version: '3.0.0',
    location_name: entry.locationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: 'MO', file_kind: 'json', observedFinding: 'mrf-template-version-noncanonical',
    next_action: 'Validate the complete Missouri file and recheck whether the literal 3.0 identifier is corrected; do not reuse the Washington sibling file.'
  }, evidence_run: 'st-joseph-kc-exact-pointer-file-2026-09-17', reviewed_at: file.checkedAt,
  note: 'Current Missouri root pointer and bounded file header agree on the Kansas City campus; the older standing MRF is a Washington St. Michael file. The Missouri file declares literal 3.0, so retain a metadata-review label, not a legal or full-file conclusion.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointerSha, sample_sha256: sampleSha,
    displaced_state: header.mrf_license_state, finding: 'mrf-template-version-noncanonical' }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
