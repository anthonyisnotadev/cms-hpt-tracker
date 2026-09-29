'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const { retrieve, sha } = require('./lib/recovery-transport');
const { requestCapped, extractDeclared } = require('./lib/probe');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '330395';
const facilityUrl = 'https://ehs.org/about/contact-us/';
const priceUrl = 'https://ehs.org/patient-visitors/price-transparency/';
const pointerUrl = 'https://ehs.org/cms-hpt.txt';
const fileUrl = 'https://apim.services.craneware.com/api-pricing-transparency/api/public/38b5f8125ca16e4e06d7110ec7d683f2/charges/mrf';
const proofName = 'reconciliation-st-johns-episcopal-current-proof.json';

async function main() {
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .find(row => row.ccn === ccn);
  const verification = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8')).records
    .find(row => row.ccn === ccn);
  const oldPointer = fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/raw/northwell.edu-c50cb73c12b6.txt'));
  const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (!base || base.finding !== 'not-assessed-not-named-in-file'
      || base.domain !== 'northwell.edu'
      || base.pointer_url !== 'https://www.northwell.edu/cms-hpt.txt'
      || !roster || roster.name !== "ST JOHN'S EPISCOPAL HOSPITAL AT SOUTH SHORE"
      || roster.address !== '327 BEACH 19TH STREET'
      || roster.city !== 'FAR ROCKAWAY' || roster.state !== 'NY' || roster.zip !== '11691'
      || verification?.pointer_corpus_sha256 !== sha(oldPointer)
      || /st\.?\s*john.?s?\s*episcopal|far\s*rockaway|beach\s*19th/i.test(oldPointer.toString('utf8'))
      || ledger.some(row => row.ccn === ccn)
      || fs.existsSync(path.join(audit, proofName)))
    throw new Error('St Johns source, old Northwell pointer or existing review changed');

  const [facility, price, pointer] = await Promise.all([
    retrieve(facilityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(priceUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
  ]);
  const facilityText = cheerio.load(facility.body.toString('utf8')).text().replace(/\s+/g, ' ');
  const priceDocument = cheerio.load(price.body.toString('utf8'));
  const pageLinks = priceDocument('a').filter((_, element) =>
    /Machine-Readable File \(MRFs\)/.test(priceDocument(element).text()))
    .map((_, element) => priceDocument(element).attr('href')).get();
  const pointerText = pointer.body.toString('utf8');
  const pointerLines = pointerText.split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  if (![200, 206].includes(facility.status) || ![200, 206].includes(price.status)
      || pointer.status !== 200 || !/^text\/plain/i.test(pointer.headers['content-type'] || '')
      || !facilityText.includes('St. John’s Episcopal Hospital')
      || !facilityText.includes('327 Beach 19th Street')
      || !facilityText.includes('Far Rockaway, NY 11691')
      || pageLinks.length !== 1 || pageLinks[0] !== fileUrl
      || pointerLines.length !== 3
      || !pointerLines.includes('location-name: Episcopal Health Services')
      || !pointerLines.includes(`source-page-url: ${priceUrl}`)
      || !pointerLines.includes(`mrf-url: ${fileUrl}`))
    throw new Error(`First-party facility, pricing-page or root-pointer linkage changed: ${JSON.stringify({
      facilityStatus: facility.status, priceStatus: price.status, pointerStatus: pointer.status,
      facilityIdentityFound: facilityText.includes('St. John’s Episcopal Hospital')
        && facilityText.includes('327 Beach 19th Street')
        && facilityText.includes('Far Rockaway, NY 11691'),
      pageLinks: pageLinks.map(url => ({ same: url === fileUrl })), pointerLines,
    })}`);

  const sample = await requestCapped(fileUrl, { cap: 262144, timeoutMs: 30000,
    headers: { Range: 'bytes=0-262143' } });
  const meta = extractDeclared(sample.body, 'csv');
  if (sample.status !== 200 || sample.body.length !== 262144
      || meta.hospitalName.trim() !== 'St Johns Episcopal Hospital'
      || !meta.locationName.split('|').every(name => name.trim() === 'St Johns Episcopal Hospital')
      || meta.address !== '327 Beach 19th St,Far Rockaway,NY,11691'
      || meta.licenseState !== 'NY'
      || meta.raw !== '4/7/2026' || meta.version !== '3.0.0')
    throw new Error('St Johns bounded pointer file header changed');

  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const retainedPath = path.join(sampleDir, `${sha(sample.body)}.bin`);
  fs.writeFileSync(retainedPath, sample.body);
  const observedAt = new Date().toISOString();
  const proof = {
    ccn, observed_at: observedAt, roster_name: roster.name,
    roster_address: roster.address, roster_city: roster.city,
    roster_state: roster.state, roster_zip: roster.zip,
    old_assigned_domain: base.domain, old_pointer_url: base.pointer_url,
    old_pointer_sha256: sha(oldPointer), old_pointer_has_far_rockaway_hospital: false,
    current_domain: 'ehs.org', facility_page_url: facilityUrl,
    facility_page_status: facility.status, facility_page_sha256: sha(facility.body),
    pricing_page_url: priceUrl, pricing_page_status: price.status,
    pricing_page_sha256: sha(price.body), pricing_page_links_exact_mrf: true,
    pointer_url: pointerUrl, pointer_status: pointer.status,
    pointer_sha256: sha(pointer.body), pointer_entry_without_contacts: pointerLines,
    pointer_file_url: fileUrl, file_sample_status: sample.status,
    retained_sample: path.relative(root, retainedPath).replaceAll('\\', '/'),
    retained_bytes: sample.body.length, sample_sha256: sha(sample.body),
    file_declared_name: meta.hospitalName.trim(), file_declared_locations: meta.locationName,
    file_declared_address: meta.address, file_declared_license_state: meta.licenseState,
    file_declared_update_raw: meta.raw, file_declared_update: '2026-04-07',
    file_declared_version: meta.version,
    limitation: 'Exact first-party site, pointer, price page and bounded CSV bytes agree on the Far Rockaway hospital, address and NY metadata. The source ignores Range and the 262144-byte retained prefix is not a complete-file or line-item CMS validation. A current CMS Hospital Enrollments query for this CCN returned no row; that absence is not treated as inactive status or as a contrary facility identity finding.',
  };
  const evidence = {
    identity: 'corroborated',
    identity_basis: 'first-party-facility-page-exact-root-pointer-price-page-and-retained-csv-header-name-address-state',
    pointerUrl, pointerSha256: proof.pointer_sha256,
    url: fileUrl, fileSha256: proof.sample_sha256, bytesRetained: proof.retained_bytes,
    http_status: proof.file_sample_status, checked_at: observedAt,
    date: proof.file_declared_update, version: proof.file_declared_version,
    officialDomain: 'ehs.org', location_name: 'St Johns Episcopal Hospital',
    declared_hospital_name: proof.file_declared_name,
    declared_address: proof.file_declared_address,
    declared_license_state: proof.file_declared_license_state,
    file_kind: 'csv', sourcePageUrl: priceUrl,
    sourcePageSha256: proof.pricing_page_sha256,
    identityPageUrl: facilityUrl, identityPageSha256: proof.facility_page_sha256,
  };
  ledger.push({ ccn, base, action: 'replace', evidence,
    evidence_run: 'st-johns-episcopal-current-header-review-2026-09-17', reviewed_at: observedAt,
    note: 'The current Episcopal Health Services facility page identifies St Johns Episcopal Hospital at the exact 327 Beach 19th Street Far Rockaway roster campus. Its root pointer names Episcopal Health Services and its price page links the exact Craneware MRF target. Retained bounded CSV bytes declare St Johns Episcopal Hospital, that campus, NY, 2026-04-07 and v3.0.0. The old Northwell pointer has no Far Rockaway/St Johns entry and remains historical. This is pointer/header identity and metadata observation, not whole-file validation or a legal compliance verdict.' });
  ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(path.join(audit, proofName), JSON.stringify(proof, null, 2) + '\n');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, domain: 'ehs.org', pointer_sha256: proof.pointer_sha256,
    sample_sha256: proof.sample_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
