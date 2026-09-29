'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://henryford.com/cms-hpt.txt';
const priceUrl = 'https://www.henryford.com/visitors/billing/cost-of-care/hospital-standard-charges';
const cases = [
  { ccn: '230197', name: 'Henry Ford Genesys Hospital', address: '1 Genesys Pkwy', zip: '48439',
    siteUrl: 'https://www.henryford.com/locations/genesys-hospital',
    fileUrl: 'https://www.henryford.com/-/media/files/henry-ford/patients-visitors/price-transparency-2026/legacy-ascension/382377821_henry-ford-genesys-hospital_standardcharges.csv',
    headerAddress: '1 Genesys Pkwy Grand Blanc Twp MI 48439' },
  { ccn: '230241', name: 'Henry Ford River District Hospital', address: '4100 River Rd', zip: '48054',
    siteUrl: 'https://www.henryford.com/locations/river-district-hospital',
    webReaderIdentity: 'Henry Ford River District Hospital; 4100 River Rd; East China, MI 48054',
    fileUrl: 'https://www.henryford.com/-/media/files/henry-ford/patients-visitors/price-transparency-2026/legacy-ascension/383160564_henry-ford-river-district-hospital_standardcharges.csv',
    headerAddress: '4100 River Rd East China Township MI 48054' },
  { ccn: '230254', name: 'Henry Ford Rochester Hospital', address: '1101 W University Dr', zip: '48307',
    siteUrl: 'https://www.henryford.com/locations/rochester-hospital',
    fileUrl: 'https://www.henryford.com/-/media/files/henry-ford/patients-visitors/price-transparency-2026/legacy-ascension/381359247_henry-ford-rochester-hospital_standardcharges.csv',
    headerAddress: '1101 W. University Dr Rochester MI 48307' },
];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  const roster = new Map(JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .map(row => [row.ccn, row]));
  const nationwide = new Map(JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'))
    .records.map(row => [row.ccn, row]));
  const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  for (const item of cases) {
    const r = roster.get(item.ccn), n = nationwide.get(item.ccn);
    if (r?.state !== 'MI' || n?.disposition !== 'pointer-facility-match-unresolved'
        || n.official_domain !== 'healthcare.ascension.org'
        || ledger.records.some(row => row.ccn === item.ccn))
      throw new Error(`Standing data or review changed for ${item.ccn}`);
  }
  const [pointer, page, ...others] = await Promise.all([
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(priceUrl, 262144, { timeoutMs: 30000 }),
    ...cases.flatMap(item => [
      retrieve(item.siteUrl, 1048576, { timeoutMs: 30000 }),
      retrieve(item.fileUrl, 262144, { timeoutMs: 35000 }),
    ]),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const $page = cheerio.load(page.body.toString('utf8'));
  const priceLinks = $page('a[href]').map((_, node) => new URL($page(node).attr('href'), priceUrl).href).get();
  if (![200, 206].includes(pointer.status) || ![200, 206].includes(page.status))
    throw new Error(`Current Henry Ford root/price page inaccessible: ${pointer.status}/${page.status}`);
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  const records = [];
  for (const [i, item] of cases.entries()) {
    const site = others[i * 2], file = others[i * 2 + 1];
    const $site = cheerio.load(site.body.toString('utf8'));
    const siteText = $site('body').text().replace(/\s+/g, ' ');
    const entry = pointerText.split(/\r?\n\s*\r?\n/).find(block =>
      block.split(/\r?\n/).some(line => line.trim() === `location-name: ${item.name}`));
    const safeEntry = entry?.split(/\r?\n/).map(line => line.trim())
      .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
    const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed
      .find(row => row.innerKind === 'csv');
    const boundedSiteIdentity = siteText.includes(item.name) && siteText.includes(item.address)
      && siteText.includes(item.zip);
    if (![200, 206].includes(site.status) || ![200, 206].includes(file.status)
        || file.body.length !== 262144 || (!boundedSiteIdentity && !item.webReaderIdentity)
        || !priceLinks.includes(item.fileUrl)
        || !safeEntry?.includes(`mrf-url: ${item.fileUrl}`)
        || parsed?.mrfHospitalName !== 'Henry Ford Health'
        || parsed.mrfLocationName !== item.name || parsed.mrfAddress !== item.headerAddress
        || parsed.mrfLicenseState !== 'MI' || parsed.declaredLastUpdated !== '2026-01-01'
        || parsed.cmsVersion !== '3.0.0')
      throw new Error(`Current Henry Ford evidence changed for ${item.ccn}: ${JSON.stringify({site:site.status,file:file.body.length,siteName:siteText.includes(item.name),siteAddress:siteText.includes(item.address),siteZip:siteText.includes(item.zip),pageLink:priceLinks.includes(item.fileUrl),pointerEntry:safeEntry,parsed})}`);
    const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
    records.push({ ccn: item.ccn, roster_name: roster.get(item.ccn).name,
      roster_address: roster.get(item.ccn).address, roster_city: roster.get(item.ccn).city,
      roster_state: roster.get(item.ccn).state, roster_zip: roster.get(item.ccn).zip,
      facility_name: item.name, facility_page_url: item.siteUrl, facility_page_sha256: site.sha256,
      facility_page_http_status: site.status, facility_page_observed_at: site.checkedAt,
      facility_page_bounded_text_identity: boundedSiteIdentity,
      ...(item.webReaderIdentity ? { facility_page_web_reader_identity: item.webReaderIdentity } : {}),
      pricing_page_url: priceUrl, pricing_page_sha256: page.sha256,
      pointer_entry_without_contacts: safeEntry, mrf_url: item.fileUrl,
      file_http_status: file.status, file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
      retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
      retained_bytes: file.body.length, retained_sha256: file.sha256,
      declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
      declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
      declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
      observed_at: file.checkedAt, _bytes: file.body });
  }
  fs.mkdirSync(sampleDir, { recursive: true });
  for (const record of records) {
    fs.writeFileSync(path.join(root, record.retained_sample), record._bytes);
    delete record._bytes;
  }
  const proof = { pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, pointer_observed_at: pointer.checkedAt,
    pricing_page_url: priceUrl, pricing_page_http_status: page.status,
    pricing_page_sha256: page.sha256, pricing_page_observed_at: page.checkedAt,
    records, limitation: 'First-party facility pages, pointer entries, price-page links and bounded CSV headers agree on three campuses. The roster uses former Ascension names. These are 262144-byte prefixes, not complete-file validations or legal-compliance determinations.' };
  const proofFile = 'reconciliation-henry-ford-transition-proof.json';
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  for (const record of records) ledger.records.push({ ccn: record.ccn, observed_at: record.observed_at,
    proof_file: proofFile, former_roster_name: record.roster_name,
    current_facility_name: record.facility_name, current_facility_page: record.facility_page_url,
    current_pointer_url: pointerUrl, current_pointer_sha256: pointer.sha256,
    current_mrf_url: record.mrf_url, current_mrf_sample_sha256: record.retained_sha256,
    disposition: 'first-party-ownership-transition-pointer-and-file-identity-corroborated',
    next_action: 'Review the former Ascension name against the current Henry Ford campus and exact root pointer, then apply a guarded site/file correction. Validate the complete CSV before any full-file or legal-compliance claim.' });
  ledger.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ pointer_sha256: pointer.sha256, cases: records.map(row => ({ccn:row.ccn,sha256:row.retained_sha256})) }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
