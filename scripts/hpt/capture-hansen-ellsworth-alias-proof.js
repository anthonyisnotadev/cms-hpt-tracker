'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '161380';
const identityUrl = 'https://www.hansenfamilyhospital.com/about-us/about-hansen-family-hospital/';
const stateUrl = 'https://hhs.iowa.gov/media/18013/download?inline=';
const pricingUrl = 'https://apps.para-hcfs.com/PTT/FinalLinks/Hansen_Family_Hospital.aspx';
const pointerUrl = 'https://www.hansenfamilyhospital.com/cms-hpt.txt';
const fileUrl = 'https://apps.para-hcfs.com/PTT/FinalLinks/Reports.aspx?dbName=dbEMHIOWAFALLSIA&type=CDMWithoutLabel&fileType=CSV';
const pageFileUrl = 'https://apps.para-hcfs.com/PTT/FinalLinks/Reports.aspx?dbName=dbEMHIOWAFALLSIA&type=CDMWithoutLabel';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'HANSEN FAMILY HOSPITAL' || roster.Address !== '920 SOUTH OAK STREET'
      || roster['City/Town'] !== 'IOWA FALLS' || roster.State !== 'IA' || roster['ZIP Code'] !== '50126'
      || base?.finding !== 'not-assessed-not-named-in-file' || base.pointer_url !== 'https://mercyone.org/cms-hpt.txt')
    throw new Error('Hansen roster or previous assessment changed');
  const [identity, state, pricing, pointer, file, pageFile] = await Promise.all([
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(stateUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
    retrieve(pageFileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const pricingHtml = pricing.body.toString('utf8');
  const pointerSafe = pointer.body.toString('utf8').split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv');
  if ([identity, state, pricing, pointer, file, pageFile].some(result => ![200, 206].includes(result.status))
      || !identityText.includes('Hansen Family Hospital') || !identityText.includes('920 South Oak Street')
      || !identity.body.toString('utf8').includes(pricingUrl)
      || !pricingHtml.includes('dbEMHIOWAFALLSIA')
      || !pricingHtml.includes("DownloadReport('hospital', 'CDMWithoutLabel')")
      || !pricingHtml.includes("'Reports.aspx?dbName=' + db + '&type=' + type")
      || !pointerSafe.includes('location-name: Hansen Family Hospital - Iowa Falls, IA')
      || !pointerSafe.includes(`source-page-url: ${pricingUrl}`)
      || !pointerSafe.includes(`mrf-url: ${fileUrl}`)
      || file.body.length !== 262144 || pageFile.body.length !== 262144
      || file.sha256 !== pageFile.sha256
      || file.headers['content-disposition'] !== 'attachment; filename="426005855_ellsworth-municipal-hospital_standardcharges.csv"'
      || parsed?.mrfHospitalName !== 'ELLSWORTH MUNICIPAL HOSPITAL'
      || parsed.mrfLocationName !== 'ELLSWORTH MUNICIPAL HOSPITAL'
      || parsed.mrfAddress !== '920 S Oak St Iowa Falls IA 50126'
      || parsed.mrfLicenseState !== 'IA' || parsed.declaredLastUpdated !== '2026-07-10'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Hansen campus, pointer, publisher report, or CSV metadata changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    first_party_identity_url: identityUrl, first_party_identity_sha256: identity.sha256,
    state_dba_bridge_url: stateUrl, state_dba_bridge_sha256: state.sha256,
    state_dba_bridge_claim: 'Ellsworth Municipal Hospital DBA Hansen Family Hospital at 920 S Oak St, Iowa Falls, Iowa 50126',
    pricing_url: pricingUrl, pricing_sha256: pricing.sha256,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_entry_without_contacts: pointerSafe,
    pointer_file_url: fileUrl, pointer_file_http_status: file.status,
    pricing_page_generated_file_url: pageFileUrl, pricing_page_file_http_status: pageFile.status,
    page_and_pointer_sample_match: file.sha256 === pageFile.sha256,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, observed_at: file.checkedAt,
    limitation: 'The hosted CSV used chunked transfer and only the first 262144 bytes were retained. The pricing-page generated URL lacks the pointer URL fileType parameter but both prefixes are byte-identical. The Iowa HHS filing supplies the legal-name/DBA bridge. Complete-file structure, content and legal compliance remain unverified.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === ccn)) throw new Error('Existing Hansen resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-hansen-ellsworth-alias-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn, base, action: 'replace', evidence: {
    identity: 'corroborated', identity_basis: 'state-hhs-ellsworth-dba-hansen-exact-campus-first-party-pointer-pricing-page-csv-header',
    officialDomain: 'hansenfamilyhospital.com', identityPageUrl: identityUrl, identityPageSha256: identity.sha256,
    stateIdentityUrl: stateUrl, stateIdentitySha256: state.sha256,
    sourcePageUrl: pricingUrl, sourcePageSha256: pricing.sha256,
    pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status, checked_at: file.checkedAt,
    date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: 'Hansen Family Hospital - Iowa Falls, IA', declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'csv',
    next_action: 'Validate the complete hosted CSV and reconcile its legal hospital name against current publisher and state records before any legal-compliance conclusion.',
  }, evidence_run: 'hansen-ellsworth-dba-exact-campus-2026-09-16', reviewed_at: file.checkedAt,
  note: 'The Hansen first-party site identifies the 920 South Oak Street hospital and links the PARA pricing page. Its own root pointer names a PARA CSV; the pricing-page generated report URL returns the same retained prefix. The CSV declares Ellsworth Municipal Hospital at the exact Iowa Falls campus, IA, 2026-07-10 and v3.0.0. A 2026 Iowa HHS filing explicitly names Ellsworth Municipal Hospital DBA Hansen Family Hospital at that address. The prior MercyOne-domain nonmatch reflected affiliate-domain selection, not an observed Hansen file failure. This is a bounded identity/pointer/file observation, not complete-file validation or a legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, sample_sha256: file.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
