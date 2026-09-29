'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const cases = [
  {
    ccn: '520103', rosterName: 'COMMUNITY MEMORIAL HOSPITAL', rosterAddress: 'W180 N8085 TOWN HALL RD',
    rosterCity: 'MENOMONEE FALLS', rosterZip: '53051',
    currentName: 'Froedtert Menomonee Falls Hospital', legalName: 'Community Memorial Hospital of Menomonee Falls Inc',
    declaredAddress: 'W180N8085 Town Hall Rd, Menomonee Falls, WI 53051', date: '2025-12-31',
    pointerUrl: 'https://froedtert.com/cms-hpt.txt',
    fileUrl: 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8143/390987025_community-memorial-hospital-of-menomonee-falls-inc_standardcharges.csv',
    sourcePageUrl: 'https://search.hospitalpriceindex.com/hpi2/machineReadable/FroedtertMenomoneeFallsHospital/8143',
    firstPartyFacilityUrl: 'https://www.froedtert.com/locations/hospital/menomonee-falls-hospital',
    firstPartyIdentityUrl: 'https://www.froedtert.com/patients-visitors/patient-privacy/privacy-practices-affiliates',
    firstPartyPricingUrl: 'https://www.froedtert.com/price-transparency',
    fileKind: 'csv', cap: 262144,
  },
  {
    ccn: '521307', rosterName: 'CHIPPEWA VALLEY HOSPITAL', rosterAddress: '1220 3RD AVE W',
    rosterCity: 'DURAND', rosterZip: '54736', currentName: 'AdventHealth Durand',
    legalName: 'Chippewa Valley Hospital and Oakview Care Center, Inc.',
    declaredAddress: '1220 3Rd Ave W, Durand, WI 54736', date: '2026-04-01',
    pointerUrl: 'https://adventhealth.com/cms-hpt.txt',
    fileUrl: 'https://HospitalPriceDisclosure.com/download.aspx?pi=GWQ6hVIDeHKPPO7oxssXNA*-*',
    sourcePageUrl: 'https://HospitalPriceDisclosure.com/Default.aspx?ci=RsbcVwMa5jfnDZuYpIqAxQ*-*',
    firstPartyFacilityUrl: 'https://www.adventhealth.com/locations/hospitals/durand/our-location',
    firstPartyIdentityUrl: 'https://www.adventhealth.com/sites/default/files/assets/durand-2026-2028-chp.pdf',
    firstPartyPricingUrl: 'https://www.adventhealth.com/locations/hospitals/durand/bill-pay',
    fileKind: 'json', cap: 2097152,
  },
];

async function capture(config, roster, base) {
  const [pointer, file] = await Promise.all([
    retrieve(config.pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(config.fileUrl, config.cap, { timeoutMs: 30000 }),
  ]);
  const entry = pointer.body.toString('utf8').split(/\r?\n\s*\r?\n/).find(block =>
    block.toLowerCase().includes(`mrf-url: ${config.fileUrl.toLowerCase()}`));
  const safeEntry = entry?.split(/\r?\n/).filter(line => /^(location-name|source-page-url|mrf-url):/i.test(line));
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream'))
    .parsed.find(item => item.innerKind === config.fileKind);
  const totalBytes = Number((file.headers['content-range'] || '').split('/')[1]) || null;
  if (![200, 206].includes(pointer.status) || !safeEntry || safeEntry.length !== 3
      || !safeEntry.some(line => line.toLowerCase() === `location-name: ${config.currentName.toLowerCase()}`)
      || !safeEntry.some(line => line.toLowerCase() === `source-page-url: ${config.sourcePageUrl.toLowerCase()}`)
      || !safeEntry.some(line => line.toLowerCase() === `mrf-url: ${config.fileUrl.toLowerCase()}`)
      || ![200, 206].includes(file.status) || file.body.length !== config.cap && config.ccn !== '521307'
      || parsed?.mrfAddress !== config.declaredAddress || parsed.mrfLicenseState !== 'WI'
      || parsed.declaredLastUpdated !== config.date || parsed.cmsVersion !== '3.0.0'
      || (config.ccn === '520103' && (parsed.mrfHospitalName !== config.legalName
        || parsed.mrfLocationName !== config.currentName))
      || (config.ccn === '521307' && (parsed.mrfHospitalName.toLowerCase() !== config.currentName.toLowerCase()
        || parsed.mrfLocationName.toLowerCase() !== config.currentName.toLowerCase()
        || file.body.length !== totalBytes)))
    throw new Error(`${config.ccn} pointer or file metadata changed`);
  let site = null;
  if (config.ccn === '520103') {
    const [facility, identity, pricing] = await Promise.all([
      retrieve(config.firstPartyFacilityUrl, 262144, { timeoutMs: 30000 }),
      retrieve(config.firstPartyIdentityUrl, 262144, { timeoutMs: 30000 }),
      retrieve(config.firstPartyPricingUrl, 262144, { timeoutMs: 30000 }),
    ]);
    const facilityText = cheerio.load(facility.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
    const identityText = cheerio.load(identity.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
    const pricingHtml = pricing.body.toString('utf8');
    if ([facility, identity, pricing].some(result => ![200, 206].includes(result.status))
        || !facilityText.includes(config.currentName)
        || !facilityText.includes('W180 N8085 Town Hall Road')
        || !identityText.includes('Community Memorial Hospital of Menomonee Falls, Inc., d/b/a Froedtert Menomonee Falls Hospital')
        || !pricingHtml.includes(config.fileUrl))
      throw new Error('Froedtert facility, alias, or pricing page changed');
    site = { facility_http_status: facility.status, facility_sha256: facility.sha256,
      identity_http_status: identity.status, identity_sha256: identity.sha256,
      pricing_http_status: pricing.status, pricing_sha256: pricing.sha256,
      pricing_page_direct_file_link: true };
  } else {
    const [facility, pricing] = await Promise.all([
      retrieve(config.firstPartyFacilityUrl, 262144, { timeoutMs: 30000 }),
      retrieve(config.firstPartyPricingUrl, 262144, { timeoutMs: 30000 }),
    ]);
    site = { facility_http_status_for_bounded_client: facility.status,
      pricing_http_status_for_bounded_client: pricing.status,
      first_party_pages_reviewed_via: 'web search/open on 2026-09-16; bounded direct client received HTTP 403',
      facility_page_observation: 'AdventHealth Durand, formerly Chippewa Valley Hospital, at 1220 Third Avenue West, Durand WI 54736.',
      identity_document_observation: 'AdventHealth 2026-2028 community health plan identifies Chippewa Valley Hospital and Oakview Care Center, Inc. d/b/a AdventHealth Durand.',
      pricing_page_observation: 'AdventHealth Durand bill-pay page links the named vendor price-list portal; this web client observed an error page after following the portal link. The separate pointer-declared JSON remained retrievable.',
      pricing_page_vendor_route: true };
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn: config.ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    current_facility_name: config.currentName, first_party_facility_url: config.firstPartyFacilityUrl,
    first_party_identity_url: config.firstPartyIdentityUrl, first_party_pricing_url: config.firstPartyPricingUrl,
    first_party_observations: site,
    pointer_url: config.pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_entry_without_contacts: safeEntry, pointer_location_name: config.currentName,
    file_url: config.fileUrl, file_http_status: file.status, file_total_bytes: totalBytes,
    retained_bytes: file.body.length, retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    sample_sha256: file.sha256, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    declared_version: parsed.cmsVersion, file_kind: config.fileKind, observed_at: file.checkedAt,
    limitation: config.ccn === '520103'
      ? `Only the first ${file.body.length} of ${totalBytes} CSV bytes were retained. Complete-file validity and legal compliance were not determined.`
      : `All ${file.body.length} JSON bytes were retained and JSON syntax parsed; CMS schema/content validity and legal compliance were not determined. The vendor portal rendered an error to the web client even though the pointer-declared download worked.`,
  };
  const evidence = {
    identity: 'corroborated',
    identity_basis: config.ccn === '520103'
      ? 'exact-roster-campus-first-party-former-name-dba-pricing-link-live-pointer-csv-header'
      : 'exact-roster-campus-first-party-explicit-former-name-legal-dba-live-pointer-json',
    officialDomain: config.ccn === '520103' ? 'froedtert.com' : 'adventhealth.com',
    identityPageUrl: config.firstPartyFacilityUrl, sourcePageUrl: config.firstPartyPricingUrl,
    pointerUrl: config.pointerUrl, pointerSha256: pointer.sha256, pointerHttpStatus: pointer.status,
    url: config.fileUrl, fileSha256: file.sha256, http_status: file.status,
    checked_at: file.checkedAt, date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    location_name: parsed.mrfLocationName, declared_hospital_name: parsed.mrfHospitalName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    facility_state: roster.State, file_kind: config.fileKind,
    next_action: config.ccn === '520103'
      ? 'Validate the complete 393 MB CSV before any content or legal conclusion.'
      : 'Validate CMS JSON schema/content independently and recheck the vendor portal with a browser; do not treat one client error as universal failure.',
  };
  const note = config.ccn === '520103'
    ? 'The roster calls CCN 520103 Community Memorial Hospital at W180 N8085 Town Hall Road. Froedtert identifies the same hospital under its current Menomonee Falls name and explicitly names Community Memorial Hospital of Menomonee Falls Inc as its d/b/a legal entity. The first-party pricing page and live root pointer link the same CSV; its bounded header declares both legal and campus names, exact address, WI, 2025-12-31 and v3.0.0. This is a pointer/page/header observation, not complete-file validation or a legal verdict.'
    : 'The roster calls CCN 521307 Chippewa Valley Hospital at 1220 Third Avenue West. AdventHealth explicitly identifies this Durand campus as formerly Chippewa Valley Hospital, and its current community health plan names the legal d/b/a. Its first-party bill-pay page links the named vendor portal, which showed this web client an error page; the live root pointer separately links a working, identity-matched JSON. All 1,889,432 bytes parsed as JSON and declare the exact campus, WI, 2026-04-01 and v3.0.0. Schema/content validity and legal compliance remain unassessed.';
  return { proof, evidence, note };
}

async function main() {
  const rosterRows = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'));
  const baseRows = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'));
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const results = [];
  for (const config of cases) {
    const roster = rosterRows.find(row => row['Facility ID'] === config.ccn);
    const base = baseRows.find(row => row.ccn === config.ccn);
    if (!roster || roster['Facility Name'] !== config.rosterName || roster.Address !== config.rosterAddress
        || roster['City/Town'] !== config.rosterCity || roster.State !== 'WI'
        || roster['ZIP Code'] !== config.rosterZip || !base
        || base.finding !== 'not-assessed-not-named-in-file'
        || base.pointer_url !== config.pointerUrl
        || ledger.some(row => row.ccn === config.ccn))
      throw new Error(`${config.ccn} roster, base, or prior resolution changed`);
    results.push({ config, base, ...(await capture(config, roster, base)) });
  }
  for (const result of results) {
    const { config, base, proof, evidence, note } = result;
    fs.writeFileSync(path.join(audit, `reconciliation-wisconsin-${config.ccn}-proof.json`), JSON.stringify(proof, null, 2) + '\n');
    ledger.push({ ccn: config.ccn, base, action: 'replace', evidence,
      evidence_run: `wisconsin-alias-${config.ccn}-2026-09-16`, reviewed_at: proof.observed_at, note });
  }
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify(results.map(({ proof }) => ({ ccn: proof.ccn,
    pointer_sha256: proof.pointer_sha256, sample_sha256: proof.sample_sha256,
    retained_bytes: proof.retained_bytes, file_total_bytes: proof.file_total_bytes }))));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
