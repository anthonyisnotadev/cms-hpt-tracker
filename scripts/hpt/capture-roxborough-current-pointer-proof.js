'use strict';

// Bounded first-party recheck justified by an indexed sibling-version link
// selecting the wrong host's copy of Roxborough's shared JSON.
const fs = require('node:fs');
const path = require('node:path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { parsePointer } = require('./lib/parse');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '390304';
const pointerUrl = 'https://www.roxboroughmemorial.com/cms-hpt.txt';
const fileUrl = 'https://roxboroughmemorial.com/wp-content/uploads/2026/09/910401_RoxboroughMemorialHospital_standardcharges.json';
const expectedAddress = '5800 Ridge Avenue Philadelphia, PA  19128';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'ROXBOROUGH MEMORIAL HOSPITAL'
      || roster.Address !== '5800 RIDGE AVE' || roster.State !== 'PA'
      || base?.finding !== 'compliant-observed' || base.pointer_url !== pointerUrl)
    throw new Error('Roxborough roster or base assessment changed');
  const [pointer, file] = await Promise.all([
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 1048576, { timeoutMs: 35000 })
  ]);
  const entry = parsePointer(pointer.body.toString('utf8')).entries
    .find(item => item.locationName === 'Roxborough Memorial Hospital'
      && (item.mrfUrls || []).includes(fileUrl));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/json')).parsed
    .find(item => item.innerKind === 'json');
  if (![200, 206].includes(pointer.status) || ![200, 206].includes(file.status)
      || !entry || file.body.length !== 1048576
      || parsed?.mrfHospitalName !== 'Roxborough Memorial Hospital'
      || !String(parsed.mrfLocationName || '').split('|').includes('Roxborough Memorial Hospital')
      || !String(parsed.mrfAddress || '').split('|').includes(expectedAddress)
      || parsed.mrfLicenseState !== 'PA' || parsed.declaredLastUpdated !== '2026-09-01'
      || parsed.cmsVersion !== '3.0')
    throw new Error(`Roxborough pointer/file evidence changed: pointer ${pointer.status}, file ${file.status}`);
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Roxborough already has a reviewed resolution');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State,
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, pointer_observed_at: pointer.checkedAt,
    pointer_location_name: entry.locationName, pointer_mrf_url: fileUrl,
    file_url: fileUrl, file_http_status: file.status,
    file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, file_observed_at: file.checkedAt,
    declared_hospital_name: parsed.mrfHospitalName,
    declared_location_names: parsed.mrfLocationName,
    declared_addresses: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    expected_version: '3.0.0',
    cms_schema_source: 'https://github.com/CMSgov/hospital-price-transparency/blob/master/documentation/JSON/schemas/README.md',
    superseded_selected_file_url: 'https://suburbanbhc.org/wp-content/uploads/2026/09/910401_RoxboroughMemorialHospital_standardcharges.json',
    limitation: 'A bounded prefix and first-party root pointer establish the exact Roxborough location and declared metadata, not complete-file validity. The literal version is 3.0; the current CMS JSON schema is V3.0.0. No legal compliance conclusion is made.'
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-roxborough-current-pointer-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace-observation', evidence: {
    identity: 'corroborated', identity_basis: 'first-party-root-pointer-exact-roxborough-location-and-file-header-address-state',
    officialDomain: 'roxboroughmemorial.com', pointerUrl, pointerSha256: pointer.sha256,
    pointerHttpStatus: pointer.status, url: fileUrl, fileSha256: file.sha256,
    http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion, expected_version: '3.0.0',
    location_name: 'Roxborough Memorial Hospital', declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: 'PA', file_kind: 'json', observedFinding: 'mrf-template-version-noncanonical',
    next_action: 'Check publisher correction of the literal 3.0 version and validate the complete pointer-linked Roxborough file; keep the Suburban campus entry distinct.'
  }, evidence_run: 'roxborough-exact-pointer-file-version-2026-09-17', reviewed_at: file.checkedAt,
  note: 'The current Roxborough root pointer separately names Roxborough and links the Roxborough-host September JSON. A bounded file prefix names the exact 5800 Ridge Avenue PA campus and declares 2026-09-01 with literal version 3.0, while CMS publishes V3.0.0. This is an observed metadata label needing review, not a full-file or legal-compliance verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256,
    file_sample_sha256: file.sha256, observed_finding: 'mrf-template-version-noncanonical' }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
