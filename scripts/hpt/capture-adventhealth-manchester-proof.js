'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://adventhealth.com/cms-hpt.txt';
const locationUrl = 'https://www.adventhealth.com/locations/hospitals/manchester/our-location';
const hospitalUrl = 'https://www.adventhealth.com/locations/hospitals/manchester';
const portalUrl = 'https://HospitalPriceDisclosure.com/Default.aspx?ci=RsbcVwMa5jfnDZuYpIqAxQ*-*';
const fileUrl = 'https://HospitalPriceDisclosure.com/download.aspx?pi=es37dT7*__*ta95crXbYUSJaQ*-*';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '180043');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '180043');
  if (!roster || roster['Facility Name'] !== 'AdventHealthManchester'
      || roster.Address !== '210 MARIE LANGDON DRIVE' || roster['City/Town'] !== 'MANCHESTER'
      || roster.State !== 'KY' || roster['ZIP Code'] !== '40962'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.pointer_url !== pointerUrl)
    throw new Error('Manchester roster or previous assignment changed');
  const [pointer, file, portal] = await Promise.all([
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
    retrieve(portalUrl, 4096, { timeoutMs: 20000 }),
  ]);
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes('location-name: Adventhealth Manchester'));
  const safeEntry = entry?.split(/\r?\n/).filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream'))
    .parsed.find(item => item.innerKind === 'json');
  if (![200, 206].includes(pointer.status) || !safeEntry?.includes('location-name: Adventhealth Manchester')
      || !safeEntry.includes(`source-page-url: ${portalUrl}`)
      || !safeEntry.includes(`mrf-url: ${fileUrl}`)
      || ![200, 206].includes(file.status) || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'Adventhealth Manchester'
      || parsed.mrfLocationName !== 'Adventhealth Manchester'
      || parsed.mrfAddress !== '210 Marie Langdon Drive, Manchester, KY 40962'
      || parsed.mrfLicenseState !== 'KY' || parsed.declaredLastUpdated !== '2026-04-01'
      || parsed.cmsVersion !== '3.0.0'
      || ![200, 206].includes(portal.status)
      || !/\/error\/default\.htm$/i.test(portal.finalUrl || ''))
    throw new Error('Manchester pointer, JSON header, or portal observation changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn: '180043', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    first_party_hospital_url: hospitalUrl, first_party_location_url: locationUrl,
    first_party_page_reviewed_via: 'web search/open on 2026-09-16; direct client received HTTP 403',
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_entry_without_contacts: safeEntry, pointer_location_name: 'Adventhealth Manchester',
    pointer_source_portal_url: portalUrl, portal_client_final_url: portal.finalUrl,
    portal_client_response_sha256: portal.sha256,
    file_url: fileUrl, file_http_status: file.status,
    file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, observed_at: file.checkedAt,
    limitation: 'Only 262,144 JSON bytes were retained. The official hospital page links the vendor portal, which redirected this client to an error page, while the root pointer directly names a working file. Portal behavior for other clients, full-file validity, and legal compliance were not determined.',
  };
  const evidence = {
    identity: 'corroborated', identity_basis: 'first-party-manchester-campus-live-root-pointer-exact-name-street-state-json-header',
    officialDomain: 'adventhealth.com', identityPageUrl: locationUrl,
    sourcePageUrl: hospitalUrl, pointerUrl, pointerSha256: pointer.sha256,
    pointerHttpStatus: pointer.status, pointerSourcePortalUrl: portalUrl,
    portalClientFinalUrl: portal.finalUrl,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status,
    checked_at: file.checkedAt, date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: parsed.mrfLocationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'json',
    next_action: 'Validate the complete pointer-declared JSON and recheck the hospital-linked vendor portal through an ordinary browser or after a publisher update; this client saw an error redirect, not proof of universal portal failure.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === '180043')) throw new Error('Existing Manchester resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-adventhealth-manchester-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn: '180043', base, action: 'replace', evidence,
    evidence_run: 'adventhealth-manchester-joined-name-2026-09-16', reviewed_at: file.checkedAt,
    note: 'The roster joins AdventHealth and Manchester without a space; the current first-party hospital identifies the exact 210 Marie Langdon Drive campus. The live root pointer names Adventhealth Manchester and directly links a readable JSON whose bounded header matches the exact campus, Kentucky, 2026-04-01, and v3.0.0. The hospital-linked portal redirected this client to an error page, but the pointer file worked; no universal portal or full-file compliance conclusion is inferred.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '180043', pointer_sha256: pointer.sha256,
    sample_sha256: file.sha256, portal_client_final_url: portal.finalUrl }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
