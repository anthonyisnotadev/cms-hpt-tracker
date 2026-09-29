'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const identityUrl = 'https://www.hudsonregionalhospital.com/about/about-us/';
const contactUrl = 'https://www.hudsonregionalhospital.com/contact/';
const pricingUrl = 'https://www.hudsonregionalhospital.com/hospital-charges/';
const portalUrl = 'https://apps.para-hcfs.com/PTT/FinalLinks/HudsonRegional.aspx';
const independentIdentityUrl = 'https://www.nlrb.gov/case/22-RC-389971';
const pointerUrl = 'https://hudsonregionalhospital.com/cms-hpt.txt';
const fileUrl = 'https://apps.para-hcfs.com/PTT/FinalLinks/Reports.aspx?dbName=dbLHCSECAUCUSNJ&type=CDMWithoutLabel&fileType=CSV';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '310118');
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === '310118');
  if (!roster || roster['Facility Name'] !== 'HUDSON REGIONAL HOSPITAL'
      || roster.Address !== '55 MEADOWLANDS PKWY' || roster['City/Town'] !== 'SECAUCUS'
      || roster.State !== 'NJ' || roster['ZIP Code'] !== '07094'
      || !base || base.finding !== 'not-assessed-not-named-in-file'
      || base.pointer_url !== pointerUrl)
    throw new Error('Secaucus roster or previous assignment changed');
  const [identity, contact, pricing, portal, pointer, file] = await Promise.all([
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(contactUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(portalUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const contactText = cheerio.load(contact.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const pricingHtml = pricing.body.toString('utf8');
  const portalHtml = portal.body.toString('utf8');
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/)
    .find(block => block.includes('location-name: Secaucus University Hospital'));
  const safeEntry = entry?.split(/\r?\n/).filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv'))
    .parsed.find(item => item.innerKind === 'csv');
  if ([identity, contact, pricing, portal, pointer, file].some(result => ![200, 206].includes(result.status))
      || !identityText.includes('Secaucus University Hospital')
      || !identityText.includes('Hudson Regional Hospital')
      || !contactText.includes('Secaucus University Hospital')
      || !contactText.includes('55 Meadowlands Parkway')
      || !pricingHtml.includes('Secaucus University Hospital')
      || !pricingHtml.includes(portalUrl)
      || !portalHtml.includes('dbLHCSECAUCUSNJ')
      || !portalHtml.includes("DownloadReport('hospital', 'CDMWithoutLabel')")
      || !safeEntry?.includes('location-name: Secaucus University Hospital')
      || !safeEntry.includes(`source-page-url: ${portalUrl}`)
      || !safeEntry.includes(`mrf-url: ${fileUrl}`)
      || file.body.length !== 262144
      || parsed?.mrfHospitalName !== 'NJMHMC LLC'
      || parsed.mrfLocationName !== 'NJMHMC LLC'
      || parsed.mrfAddress !== '55 Meadowlands Pkwy Secaucus NJ 07094'
      || parsed.mrfLicenseState !== 'NJ' || parsed.declaredLastUpdated !== '2026-01-19'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Secaucus site, pointer, portal, or CSV metadata changed');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn: '310118', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    current_facility_name: 'Secaucus University Hospital',
    first_party_identity_url: identityUrl, first_party_identity_http_status: identity.status,
    first_party_identity_sha256: identity.sha256,
    first_party_contact_url: contactUrl, first_party_contact_http_status: contact.status,
    first_party_contact_sha256: contact.sha256,
    independent_legal_identity_url: independentIdentityUrl,
    independent_identity_observation: 'NLRB case 22-RC-389971 identifies NJMHMC, LLC d/b/a Secaucus University Hospital, formerly Hudson Regional Hospital, at 55 Meadowlands Parkway, Secaucus NJ 07094; reviewed 2026-09-16.',
    first_party_pricing_url: pricingUrl, first_party_pricing_http_status: pricing.status,
    first_party_pricing_sha256: pricing.sha256,
    pricing_page_observation: 'Secaucus price-estimator portal is linked; no direct Secaucus MRF link was observed in the bounded page response.',
    vendor_portal_url: portalUrl, vendor_portal_http_status: portal.status,
    vendor_portal_sha256: portal.sha256,
    vendor_portal_observation: 'The portal HTML contains a scripted standard-charges download control for its Secaucus database; it is not a plain anchor to the CSV.',
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_entry_without_contacts: safeEntry, pointer_location_name: 'Secaucus University Hospital',
    file_url: fileUrl, file_http_status: file.status,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, observed_at: file.checkedAt,
    limitation: 'Only the first 262,144 CSV bytes were retained. The first-party pricing page links a vendor estimator/portal rather than a plain Secaucus MRF anchor; the root pointer directly declares the CSV. Complete-file validity and legal compliance were not determined.',
  };
  const evidence = {
    identity: 'corroborated', identity_basis: 'cms-roster-exact-secaucus-street-first-party-renaming-nlrb-legal-entity-live-pointer-csv-header',
    officialDomain: 'hudsonregionalhospital.com', identityPageUrl: identityUrl,
    sourcePageUrl: pricingUrl, pointerUrl, pointerSha256: pointer.sha256,
    pointerHttpStatus: pointer.status,
    url: fileUrl, fileSha256: file.sha256, http_status: file.status,
    checked_at: file.checkedAt, date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: 'Secaucus University Hospital', declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: 'csv',
    next_action: 'Validate the complete current CSV and clarify whether the public charges page should expose a direct Secaucus MRF link; do not infer a legal conclusion from the page route.',
  };
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.some(row => row.ccn === '310118')) throw new Error('Existing Secaucus resolution requires manual review');
  fs.writeFileSync(path.join(audit, 'reconciliation-secaucus-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.push({ ccn: '310118', base, action: 'replace', evidence,
    evidence_run: 'secaucus-hudson-rename-exact-campus-2026-09-16', reviewed_at: file.checkedAt,
    note: 'The roster calls CCN 310118 Hudson Regional Hospital at 55 Meadowlands Parkway. The current first-party site names Secaucus University Hospital at that exact campus; an NLRB case explicitly joins NJMHMC LLC, the current name, and the former name. The site pricing page links a vendor estimator/portal; the live root pointer declares the Secaucus CSV, and bounded file bytes declare NJMHMC LLC at the exact campus, New Jersey, 2026-01-19 and v3.0.0. A direct Secaucus MRF anchor was not observed on the bounded charges page. This is a pointer/page/header observation, not complete-file validation or a legal verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: '310118', pointer_sha256: pointer.sha256,
    sample_sha256: file.sha256, declared_date: parsed.declaredLastUpdated }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
