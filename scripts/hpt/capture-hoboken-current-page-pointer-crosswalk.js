'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '310040';
const pointerUrl = 'https://www.hudsonregionalhospital.com/cms-hpt.txt';
const legacyPointerUrl = 'https://carepointhealth.org/cms-hpt.txt';
const identityUrl = 'https://www.hudsonregionalhospital.com/locations-directions/';
const pricingUrl = 'https://www.hudsonregionalhospital.com/hospital-charges/';
const pointerMrfUrl = 'https://images.pricetransparency.healthcare/hudson_regional_health_hoboken/452147328_hoboken-university-hospital_standardcharges.csv';
const pageFileUrl = 'https://www.hudsonregionalhospital.com/wp-content/uploads/2026/08/452147328_hoboken-university-hospital_standardcharges-2026.csv';
const sampleSha256 = '697d0be79c937d86b18fc55e95acd816d0b8deccaab1e5058fc4fa680f84e2da';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (!roster || roster['Facility Name'] !== 'CAREPOINT HEALTH-HOBOKEN UNIVERSITY MEDICAL CENTER'
      || roster.Address !== '308 WILLOW AVE' || roster['City/Town'] !== 'HOBOKEN'
      || roster.State !== 'NJ' || roster['ZIP Code'] !== '07030'
      || !base || base.finding !== 'compliant-observed'
      || base.pointer_url !== 'https://carepointhealth.org/cms-hpt.txt'
      || base.mrf_url !== pageFileUrl)
    throw new Error('Hoboken roster or standing assessment changed');

  const priorAttempts = JSON.parse(fs.readFileSync(path.join(audit,
    'rechecks/2026-09-09/recovery-856/attempts.json'), 'utf8'));
  for (const url of [pointerMrfUrl, pageFileUrl]) {
    if (!priorAttempts.some(item => item.requested_url === url && item.status === 206
        && Number(item.bytes) === 262144 && item.sha256 === sampleSha256))
      throw new Error(`Expected dated bounded baseline missing for ${url}`);
  }

  const [pointer, legacyPointer, identity, pricing, pageFile] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(legacyPointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(identityUrl, 1048576, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 1048576, { timeoutMs: 30000 }),
    retrieve(pageFileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const block = pointerText.split(/\r?\n\s*\r?\n/)
    .find(value => /^location-name: Hoboken University Hospital\s*$/m.test(value));
  const fields = Object.fromEntries((block || '').split(/\r?\n/).map(line => {
    const at = line.indexOf(': ');
    return at < 0 ? [] : [line.slice(0, at), line.slice(at + 2).trim()];
  }).filter(pair => pair.length === 2));
  const identityText = cheerio.load(identity.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const $ = cheerio.load(pricing.body.toString('utf8'));
  const links = $('a[href]').toArray().map(node => new URL($(node).attr('href'), pricingUrl).href);
  const parsed = await parsePayload(pageFile.body, pageFile.headers['content-type'] || 'text/csv');
  const header = parsed.parsed.find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  const expectedRange = 'bytes 0-262143/191019559';
  if (![200, 206].includes(pointer.status) || pointer.body.length !== 1367
      || pointer.sha256 !== 'cd2b4c6b89e158910c192bd561da0c6b2d0d21b411d8907b6cf0eb02d5d1887b'
      || ![200, 206].includes(legacyPointer.status) || legacyPointer.sha256 !== pointer.sha256
      || fields['location-name'] !== 'Hoboken University Hospital' || fields['mrf-url'] !== pointerMrfUrl
      || identity.status !== 200 || !identityText.includes('Hoboken University Hospital')
      || !identityText.includes('308 Willow Avenue') || !identityText.includes('Hoboken, NJ 07030')
      || pricing.status !== 200 || !links.includes(pageFileUrl)
      || pageFile.status !== 206 || pageFile.body.length !== 262144
      || pageFile.headers['content-range'] !== expectedRange || pageFile.sha256 !== sampleSha256
      || header?.mrfHospitalName !== 'Hoboken University Hospital'
      || header.mrfLocationName !== 'Hoboken University Hospital'
      || header.mrfAddress !== '308 Willow Avenue, Hoboken, NJ 07030'
      || header.mrfLicenseState !== 'NJ' || header.declaredLastUpdated !== '2026-08-17'
      || header.cmsVersion !== '3.0.0')
    throw new Error('Hoboken source, pointer, bounded sample, or header changed: ' + JSON.stringify({
      pointerStatus: pointer.status, pointerSha256: pointer.sha256, pointerEntry: fields,
      legacyPointerStatus: legacyPointer.status, rootHashAgrees: legacyPointer.sha256 === pointer.sha256,
      identityStatus: identity.status, pricingStatus: pricing.status, pageLinksFile: links.includes(pageFileUrl),
      pageFileStatus: pageFile.status, range: pageFile.headers['content-range'],
      pageFileBytes: pageFile.body.length, pageFileSha256: pageFile.sha256, header,
    }));

  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${pageFile.sha256}.bin`);
  fs.writeFileSync(samplePath, pageFile.body);
  const proof = {
    ccn,
    roster_name: roster['Facility Name'],
    roster_address: roster.Address,
    roster_city: roster['City/Town'],
    roster_state: roster.State,
    roster_zip: roster['ZIP Code'],
    official_domain: 'hudsonregionalhospital.com',
    identity_page_url: identityUrl,
    identity_page_sha256: identity.sha256,
    identity_page_facility: 'Hoboken University Hospital, 308 Willow Avenue, Hoboken, NJ 07030',
    pricing_page_url: pricingUrl,
    pricing_page_sha256: pricing.sha256,
    pricing_page_file_url: pageFileUrl,
    pricing_page_links_file: true,
    pointer_url: pointerUrl,
    pointer_sha256: pointer.sha256,
    pointer_bytes: pointer.body.length,
    legacy_pointer_url: legacyPointerUrl,
    legacy_pointer_sha256: legacyPointer.sha256,
    pointer_location_name: fields['location-name'],
    pointer_mrf_url: fields['mrf-url'],
    current_file_attempt: {
      url: pageFileUrl,
      http_status: pageFile.status,
      content_range: pageFile.headers['content-range'],
      total_bytes: 191019559,
      sample_bytes: pageFile.body.length,
      sample_sha256: pageFile.sha256,
      last_modified: pageFile.headers['last-modified'] || '',
      etag: pageFile.headers.etag || '',
    },
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    pointer_file_relation: {
      distinct_urls: true,
      prior_bounded_pointer_file_sample_sha256: sampleSha256,
      current_page_file_sample_sha256: pageFile.sha256,
      complete_file_equivalence_proven: false,
      note: 'The two exact URLs have matching retained 256 KiB prefixes, but complete-file equality and current retrieval of the CDN pointer target have not been proved.'
    },
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress,
    declared_license_state: header.mrfLicenseState,
    declared_license_number: header.mrfLicenseNumber || '',
    declared_npi: header.mrfNpi || [],
    declared_date: header.declaredLastUpdated,
    version: header.cmsVersion,
    attestation_present: Boolean(header.attestation),
    observed_at: pageFile.checkedAt,
    full_file_validated: false,
    next_action: 'Keep CCN 310040 unresolved until the publisher confirms whether the pointer CDN URL and first-party page CSV are the same complete file, or a permitted complete retrieval establishes byte equality; then review the full file and usable charge rows. The matching 262,144-byte prefixes and shared filename are not complete-file identity proof.'
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-hoboken-current-page-pointer-crosswalk-proof-2026-09-30.json'),
    JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, sample_sha256: pageFile.sha256,
    sample_bytes: pageFile.body.length, full_file_bytes: 191019559, proof: 'reconciliation-hoboken-current-page-pointer-crosswalk-proof-2026-09-30.json' }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
