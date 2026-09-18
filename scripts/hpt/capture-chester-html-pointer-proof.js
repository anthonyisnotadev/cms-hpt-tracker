'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '141338';
const stateUrl = 'https://healthcarereportcard.illinois.gov/hospital/101324';
const pointerUrl = 'https://www.mhchester.com/cms-hpt.txt';
const sourceUrl = 'https://pricetransparency.accureg.net/memorialhospitalchester';
const csvUrl = 'https://cdn.accureg.net/trans/memorialhospitalchester/37-6020801_Memorial-Hospital---Chester_standardcharges.csv';
const jsonUrl = 'https://cdn.accureg.net/trans/memorialhospitalchester/37-6020801_Memorial-Hospital---Chester_standardcharges.json';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'MEMORIAL HOSPITAL' || roster.Address !== '1900 STATE ST'
      || roster['City/Town'] !== 'CHESTER' || roster.State !== 'IL' || roster['ZIP Code'] !== '62233'
      || base?.finding !== 'not-assessed-domain-unknown' || base.pointer_url)
    throw new Error('Chester roster or previous assessment changed');
  const [pointer, source, csv, json] = await Promise.all([
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(sourceUrl, 262144, { timeoutMs: 30000 }),
    retrieve(csvUrl, 262144, { timeoutMs: 35000 }),
    retrieve(jsonUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const pointerText = cheerio.load(pointer.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const sourceHtml = source.body.toString('utf8');
  const [csvParsed, jsonParsed] = await Promise.all([
    parsePayload(csv.body, csv.headers['content-type'] || 'text/csv'),
    parsePayload(json.body, json.headers['content-type'] || 'application/json'),
  ]);
  const expected = {
    declaredLastUpdated: '2026-06-04', cmsVersion: '3.0.0',
    mrfHospitalName: 'Memorial Hospital - Chester', mrfLocationName: 'Memorial Hospital - Chester',
    mrfAddress: '1900 State St, , Chester, IL 62233', mrfLicenseState: 'IL',
  };
  const agrees = result => Object.entries(expected).every(([key, value]) => result?.[key] === value);
  if (pointer.status !== 200 || !/^text\/html/i.test(pointer.headers['content-type'] || '')
      || pointer.finalUrl !== 'https://www.mhchester.com/cms-hpt-txt'
      || !pointerText.includes('location-name: Memorial Hospital')
      || !pointerText.includes(`source-page-url: ${sourceUrl}`)
      || !pointerText.includes(`mrf-url: ${sourceUrl}`)
      || !pointerText.includes('1900 State') || !pointerText.includes('Chester, Illinois 62233')
      || source.status !== 200 || !sourceHtml.includes(csvUrl.split('/').at(-1))
      || !sourceHtml.includes(jsonUrl.split('/').at(-1))
      || ![200, 206].includes(csv.status) || ![200, 206].includes(json.status)
      || csv.body.length !== 262144 || json.body.length !== 262144
      || !agrees(csvParsed.parsed.find(item => item.innerKind === 'csv'))
      || !agrees(jsonParsed.parsed.find(item => item.innerKind === 'json')))
    throw new Error('Chester HTML root, official page, or file metadata changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing Chester resolution requires manual review');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  for (const response of [csv, json])
    fs.writeFileSync(path.join(sampleDir, `${response.sha256}.bin`), response.body);
  const sample = response => path.relative(root, path.join(sampleDir, `${response.sha256}.bin`)).replaceAll('\\', '/');
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    state_hospital_directory_url: stateUrl,
    state_directory_observation: 'Memorial Hospital, 1900 State Street, Chester IL 62233, website mhchester.com',
    pointer_url: pointerUrl, pointer_final_url: pointer.finalUrl,
    pointer_http_status: pointer.status, pointer_content_type: pointer.headers['content-type'],
    pointer_sha256: pointer.sha256, pointer_html_visible_location_name: 'Memorial Hospital',
    pointer_html_visible_source_page_url: sourceUrl,
    pointer_html_visible_mrf_url: sourceUrl,
    source_page_url: sourceUrl, source_page_sha256: source.sha256,
    csv_url: csvUrl, csv_http_status: csv.status, csv_retained_bytes: csv.body.length,
    csv_retained_sample: sample(csv), csv_sample_sha256: csv.sha256,
    json_url: jsonUrl, json_http_status: json.status, json_retained_bytes: json.body.length,
    json_retained_sample: sample(json), json_sample_sha256: json.sha256,
    declared_hospital_name: expected.mrfHospitalName, declared_location_name: expected.mrfLocationName,
    declared_address: expected.mrfAddress, declared_license_state: expected.mrfLicenseState,
    declared_date: expected.declaredLastUpdated, declared_version: expected.cmsVersion,
    observed_at: csv.checkedAt,
    limitation: 'The .txt root redirects to an HTML Wix page with pointer-like text, and that text names the AccuReg HTML portal as mrf-url rather than a direct file. The portal separately links both CSV and JSON. Only 262144-byte prefixes were retained from each file; full content and legal compliance are unverified.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-chester-html-pointer-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace-observation', evidence: {
    identity: 'corroborated', identity_basis: 'state-directory-first-party-html-root-exact-campus-accureg-page-csv-and-json-headers',
    officialDomain: 'mhchester.com', stateDirectoryUrl: stateUrl,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    pointerContentType: pointer.headers['content-type'], pointerFinalUrl: pointer.finalUrl,
    pointerMrfUrl: sourceUrl, sourcePageUrl: sourceUrl, sourcePageSha256: source.sha256,
    url: csvUrl, fileSha256: csv.sha256, http_status: csv.status, checked_at: csv.checkedAt,
    date: expected.declaredLastUpdated, version: expected.cmsVersion,
    location_name: expected.mrfLocationName, declared_hospital_name: expected.mrfHospitalName,
    declared_address: expected.mrfAddress, declared_license_state: expected.mrfLicenseState,
    facility_state: roster.State, file_kind: 'csv',
    observedFinding: 'root-pointer-html-page-with-official-page-file', pointerIssue: 'root-path-serves-html-page',
    next_action: 'Publisher should make /cms-hpt.txt plain text and change mrf-url to the direct current CSV or JSON. Validate the complete file and recheck the exact root-to-file path before any clean verification or legal conclusion.',
  }, evidence_run: 'chester-html-root-accureg-csv-json-2026-09-16', reviewed_at: csv.checkedAt,
  note: 'The Illinois hospital directory and Memorial Hospital website identify the Chester campus at 1900 State Street. The current /cms-hpt.txt path redirects to a Wix HTML page containing pointer-style text, not a plain-text pointer. Its mrf-url names the AccuReg HTML pricing portal; that portal separately links CSV and JSON with matching bounded Chester, IL, 2026-06-04, v3.0.0 headers. The files are available, but root pointer format and direct-target linkage are not clean, and full-file/legal validity is unverified.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, csv_sample_sha256: csv.sha256, json_sample_sha256: json.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
