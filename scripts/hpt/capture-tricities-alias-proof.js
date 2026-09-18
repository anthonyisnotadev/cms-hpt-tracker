'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '490020';
const hospitalUrl = 'https://www.hcavirginia.com/locations/tricities-hospital';
const erUrl = 'https://www.hcavirginia.com/locations/prince-george-er';
const pricingUrl = 'https://www.hcavirginia.com/patient-resources/patient-financial-resources/pricing-transparency-cms-required-file-of-standard-charges';
const pointerUrl = 'https://hcavirginia.com/cms-hpt.txt';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  const candidate = require(path.join(audit, 'exact-address-alias-candidates.json')).candidates.find(row => row.ccn === ccn);
  const fileUrl = candidate?.mrf_url;
  if (roster?.['Facility Name'] !== 'JOHN RANDOLPH MEDICAL CENTER'
      || roster.Address !== '411 WEST RANDOLPH ROAD' || roster['City/Town'] !== 'HOPEWELL'
      || roster.State !== 'VA' || roster['ZIP Code'] !== '23860'
      || base?.finding !== 'not-assessed-not-named-in-file' || base.pointer_url !== pointerUrl
      || !fileUrl || !/[?&]sig=/.test(fileUrl))
    throw new Error('TriCities roster, prior assessment, or signed candidate changed');
  const [hospital, er, pointer, file] = await Promise.all([
    retrieve(hospitalUrl, 262144, { timeoutMs: 30000 }),
    retrieve(erUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const text = result => cheerio.load(result.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const entries = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/);
  const getEntry = name => entries.find(block => block.split(/\r?\n/).some(line => line.trim() === `location-name: ${name}`));
  const hospitalEntry = getEntry('TRICITIES HOSPITAL');
  const erEntry = getEntry('PRINCE GEORGE ER');
  const entryMatches = entry => entry?.split(/\r?\n/).some(line => line.trim() === `mrf-url: ${fileUrl}`)
    && entry.split(/\r?\n/).some(line => line.trim() === `source-page-url: ${pricingUrl}`);
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream')).parsed
    .find(item => item.innerKind === 'json');
  if ([hospital, er, pointer, file].some(result => ![200, 206].includes(result.status))
      || !text(hospital).includes('John Randolph Medical Center is now TriCities Hospital')
      || !text(hospital).includes('411 W Randolph Rd, Hopewell, VA 23860')
      || !text(er).includes('Prince George ER, A campus of TriCities Hospital')
      || !text(er).includes('1700 Temple Pkwy')
      || !entryMatches(hospitalEntry) || !entryMatches(erEntry)
      || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'TRICITIES HOSPITAL'
      || !parsed.mrfLocationName.includes('TRICITIES HOSPITAL')
      || !parsed.mrfLocationName.includes('PRINCE GEORGE EMERGENCY CENTER')
      || !parsed.mrfAddress.includes('411 W RANDOLPH RD, HOPEWELL, VA, 23860')
      || !parsed.mrfAddress.includes('1700 TEMPLE PKWY, PRINCE GEORGE, VA, 23875')
      || parsed.mrfLicenseState !== 'VA' || parsed.declaredLastUpdated !== '2026-03-01'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('TriCities rename, campus, pointer, or bounded file metadata changed');
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing TriCities resolution requires manual review');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    first_party_hospital_url: hospitalUrl, first_party_hospital_sha256: hospital.sha256,
    first_party_er_url: erUrl, first_party_er_sha256: er.sha256,
    pricing_page_url: pricingUrl,
    pricing_page_browser_observation: 'In-app browser displayed a download link labeled TriCities Hospital and Prince George Emergency Center; exact signed href was not independently extracted from that browser view.',
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256,
    pointer_location_names: ['TRICITIES HOSPITAL', 'PRINCE GEORGE ER'],
    signed_file_path: new URL(fileUrl).origin + new URL(fileUrl).pathname,
    signed_file_url_sha256: hash(fileUrl), signed_file_url_withheld: true,
    file_http_status: file.status, retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'), sample_sha256: file.sha256,
    declared_hospital_name: parsed.mrfHospitalName, declared_location_names: parsed.mrfLocationName,
    declared_addresses: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    observed_at: file.checkedAt,
    limitation: 'Only the first 262,144 bytes of a signed shared JSON were retained. The signed URL is withheld from this proof and the public tracker. Browser page shows the named download but its exact href was not verified there. Complete-file validity and legal compliance were not determined.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-tricities-alias-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace', evidence: {
    identity: 'corroborated', identity_basis: 'first-party-explicit-john-randolph-rename-exact-hopewell-campus-distinct-prince-george-er-root-pointer-shared-json-header',
    officialDomain: 'hcavirginia.com', identityPageUrl: hospitalUrl, identityPageSha256: hospital.sha256,
    otherCampusPageUrl: erUrl, otherCampusPageSha256: er.sha256,
    sourcePageUrl: pricingUrl, pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: 'TRICITIES HOSPITAL', declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'json',
    next_action: 'Validate complete signed JSON, independently compare browser pricing-page href, and renew signed access only through publisher before any legal-compliance conclusion.',
  }, evidence_run: 'tricities-john-randolph-exact-hopewell-campus-2026-09-16', reviewed_at: file.checkedAt,
  note: 'HCA explicitly says John Randolph Medical Center is now TriCities Hospital at 411 W Randolph Road. Prince George ER is a separate campus at 1700 Temple Parkway. The live root pointer labels both locations with the same signed JSON; the bounded header declares both addresses, VA, 2026-03-01 and v3.0.0. The browser pricing page names a TriCities/Prince George download but the exact href was not verified. Signed URL is withheld from public payload. This is source and identity evidence, not full-file validation or a legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, sample_sha256: file.sha256, declared_date: parsed.declaredLastUpdated }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
