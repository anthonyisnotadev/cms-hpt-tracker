'use strict';

// Exact-CCN review for a pointer entry whose location/file were observed but
// whose corpus matched_ccns field remained empty. Capture each source once.
const fs = require('node:fs');
const path = require('node:path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { parsePointer } = require('./lib/parse');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '010046';
const pointerUrl = 'https://riverviewregional.com/cms-hpt.txt';
const identityUrl = 'https://riverviewregional.com/contact-us/';
const fileUrl = 'https://riverviewregional.com/wp-content/uploads/2026/09/33411_RiverviewRegionalMedicalCenter_standardcharges.json';
const priorUrl = 'https://riverviewregional.com/wp-content/uploads/2026/04/472228529_RiverviewRegionalMedicalCenter_standardcharges.JSON';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'RIVERVIEW REGIONAL MEDICAL CENTER'
      || roster.Address !== '600 SOUTH THIRD STREET' || roster.State !== 'AL'
      || base?.finding !== 'compliant-observed' || base.mrf_url !== priorUrl)
    throw new Error('Riverview roster or standing assessment changed');
  const [pointer, page, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 1048576, { timeoutMs: 35000 })
  ]);
  const entry = parsePointer(pointer.body.toString('utf8')).entries
    .find(item => item.locationName === 'Riverview Regional Medical Center' && item.mrfUrls?.includes(fileUrl));
  const pageText = page.body.toString('utf8');
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/json')).parsed
    .find(item => item.innerKind === 'json');
  if (![200, 206].includes(pointer.status) || ![200, 206].includes(page.status)
      || ![200, 206].includes(file.status) || !entry || file.body.length !== 1048576
      || !/<title>Contact Riverview Regional Medical Center<\/title>/i.test(pageText)
      || !/600 South 3rd Street<br\s*\/>Gadsden, AL 35901/i.test(pageText)
      || parsed?.mrfHospitalName !== 'Riverview Regional Medical Center'
      || parsed.mrfAddress !== '600 South Third Street Gadsden, AL  35901'
      || parsed.mrfLicenseState !== 'AL' || parsed.declaredLastUpdated !== '2026-09-01'
      || parsed.cmsVersion !== '3.0')
    throw new Error(`Riverview exact pointer/page/file proof changed: HTTP ${pointer.status}/${page.status}/${file.status}`);
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Riverview already has a reviewed resolution');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const save = response => {
    const filePath = path.join(sampleDir, `${response.sha256}.bin`);
    fs.writeFileSync(filePath, response.body);
    return path.relative(root, filePath).replaceAll('\\', '/');
  };
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_observed_at: pointer.checkedAt,
    pointer_sha256: pointer.sha256, pointer_retained_file: save(pointer), pointer_location_name: entry.locationName,
    pointer_mrf_url: fileUrl, identity_page_url: identityUrl, identity_page_http_status: page.status,
    identity_page_observed_at: page.checkedAt, identity_page_sha256: page.sha256,
    identity_page_retained_file: save(page), identity_page_address: '600 South 3rd Street, Gadsden, AL 35901',
    file_url: fileUrl, file_http_status: file.status, file_observed_at: file.checkedAt,
    retained_bytes: file.body.length, retained_sample: save(file), sample_sha256: file.sha256,
    declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    expected_version: '3.0.0', displaced_file_url: priorUrl,
    limitation: 'Exact first-party pointer, independently corroborated campus page, and bounded file prefix support the file assignment and observed metadata. Complete-file validity and legal compliance are not established.'
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-riverview-regional-pointer-file-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace-observation', evidence: {
    identity: 'corroborated', identity_basis: 'first-party-campus-page-exact-root-pointer-and-file-name-address-state',
    officialDomain: 'riverviewregional.com', pointerUrl, pointerSha256: pointer.sha256,
    pointerHttpStatus: pointer.status, url: fileUrl, fileSha256: file.sha256,
    identityPageUrl: identityUrl, identityPageSha256: page.sha256,
    http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion, expected_version: '3.0.0',
    location_name: entry.locationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: 'AL', file_kind: 'json', observedFinding: 'mrf-template-version-noncanonical',
    next_action: 'Validate the complete September file and recheck whether the literal 3.0 template identifier is corrected.'
  }, evidence_run: 'riverview-regional-exact-pointer-file-2026-09-17', reviewed_at: file.checkedAt,
  note: 'Current Riverview contact page confirms the exact Gadsden campus; its root pointer names the September file, whose bounded header matches that campus and declares literal 3.0. This replaces the April file assignment with a metadata-review finding, not a full-file or legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, page_sha256: page.sha256,
    file_sample_sha256: file.sha256, finding: 'mrf-template-version-noncanonical' }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
