'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '230019';
const pointerUrl = 'https://henryford.com/cms-hpt.txt';
const pricingUrl = 'https://www.henryford.com/visitors/billing/cost-of-care/hospital-standard-charges';
const relationshipUrl = 'https://www.henryford.com/hcp/med-ed/residencies-fellowships/providence/obstetrics-and-gynecology-residency/teaching-sites';
const bylawsUrl = 'https://www.henryford.com/-/media/files/henry-ford/hcp/bylaws/providence-hospitals-bylaws-rr_2025.pdf';
const campuses = [
  { campus: 'Southfield', pointerName: 'Henry Ford Providence Southfield Hospital',
    facilityUrl: 'https://www.henryford.com/locations/providence-southfield-hospital',
    mrfUrl: 'https://www.henryford.com/-/media/files/henry-ford/patients-visitors/price-transparency-2026/legacy-ascension/381358212-1144210253_henry-ford-providence-southfield-hospital_standardcharges.csv',
    address: '16001 W Nine Mile Rd Southfield MI 48075', street: '16001 W 9 Mile Rd', zip: '48075',
    locationName: 'Henry Ford Providence Southfield Hospital' },
  { campus: 'Novi', pointerName: 'Henry Ford Providence Novi Hospital',
    facilityUrl: 'https://www.henryford.com/locations/providence-novi-hospital',
    mrfUrl: 'https://www.henryford.com/-/media/files/henry-ford/patients-visitors/price-transparency-2026/legacy-ascension/381358212-1144210253_henry-ford-providence-novi-hospital_standardcharges.csv',
    address: '47601 Grand River Ave Novi MI 48374', street: '47601 Grand River Ave', zip: '48374',
    locationName: 'Henry Ford Providence Novi Hospital - Novi Campus' },
];

async function main() {
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .find(row => row.ccn === ccn);
  const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'))
    .records.find(row => row.ccn === ccn);
  const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (roster?.name !== 'ASCENSION PROVIDENCE HOSPITAL, SOUTHFIELD AND NOVI'
      || roster.address !== '16001 W NINE MILE RD' || roster.state !== 'MI'
      || nationwide?.disposition !== 'pointer-facility-match-unresolved'
      || ledger.records.some(row => row.ccn === ccn))
    throw new Error('Providence combined-campus roster, standing observation or review changed');
  const [pointer, pricing, relationship, ...others] = await Promise.all([
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(relationshipUrl, 262144, { timeoutMs: 30000 }),
    ...campuses.flatMap(item => [
      retrieve(item.facilityUrl, 1048576, { timeoutMs: 30000 }),
      retrieve(item.mrfUrl, 262144, { timeoutMs: 35000 }),
    ]),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const priceLinks = $pricing('a[href]').map((_, node) =>
    new URL($pricing(node).attr('href'), pricingUrl).href).get();
  const relationshipText = cheerio.load(relationship.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  if (![200, 206].includes(pointer.status) || ![200, 206].includes(pricing.status)
      || ![200, 206].includes(relationship.status)
      || !relationshipText.includes('two campuses')
      || !relationshipText.includes('Southfield Campus') || !relationshipText.includes('Novi Campus'))
    throw new Error(`Providence source pages unavailable or relationship changed: ${pointer.status}/${pricing.status}/${relationship.status}`);
  const records = [];
  for (const [i, item] of campuses.entries()) {
    const facility = others[i * 2], file = others[i * 2 + 1];
    const facilityText = cheerio.load(facility.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
    const entry = pointerText.split(/\r?\n\s*\r?\n/).find(block =>
      block.split(/\r?\n/).some(line => line.trim() === `location-name: ${item.pointerName}`));
    const safeEntry = entry?.split(/\r?\n/).map(line => line.trim())
      .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
    const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed
      .find(row => row.innerKind === 'csv');
    const facilityTextIdentity = facilityText.includes(item.pointerName)
      && facilityText.includes(item.street) && facilityText.includes(item.zip);
    if (![200, 206].includes(facility.status) || file.status !== 206
        || file.body.length !== 262144 || !facilityTextIdentity
        || !priceLinks.includes(item.mrfUrl)
        || !safeEntry?.includes(`mrf-url: ${item.mrfUrl}`)
        || parsed?.mrfHospitalName !== 'Henry Ford Health'
        || parsed.mrfLocationName !== item.locationName || parsed.mrfAddress !== item.address
        || parsed.mrfLicenseState !== 'MI' || parsed.declaredLastUpdated !== '2026-01-01'
        || parsed.cmsVersion !== '3.0.0')
      throw new Error(`Providence ${item.campus} identity, link or metadata changed: ${JSON.stringify({ facilityStatus:facility.status, fileStatus:file.status, bytes:file.body.length, facilityTextIdentity, priceLink:priceLinks.includes(item.mrfUrl), pointerEntry:safeEntry, parsed })}`);
    records.push({ campus: item.campus, pointer_location_name: item.pointerName,
      facility_page_url: item.facilityUrl, facility_page_sha256: facility.sha256,
      facility_page_http_status: facility.status, facility_page_text_identity: facilityTextIdentity,
      pointer_entry_without_contacts: safeEntry, mrf_url: item.mrfUrl,
      mrf_http_status: file.status, file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
      retained_sample: `cms_data/hpt/nationwide-verification/file-byte-proof/${file.sha256}.bin`,
      retained_bytes: file.body.length, retained_sha256: file.sha256,
      declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
      declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
      declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
      observed_at: file.checkedAt, _bytes: file.body });
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  for (const record of records) {
    fs.writeFileSync(path.join(root, record.retained_sample), record._bytes);
    delete record._bytes;
  }
  const proof = { ccn, roster_name: roster.name, roster_address: roster.address,
    roster_city: roster.city, roster_state: roster.state, roster_zip: roster.zip,
    relationship_url: relationshipUrl, relationship_http_status: relationship.status,
    relationship_sha256: relationship.sha256, relationship_observed_at: relationship.checkedAt,
    relationship_observation: 'Henry Ford Providence has two campuses: Southfield and Novi; Southfield is the home base.',
    bylaws_url: bylawsUrl,
    bylaws_web_reader_observation: 'The March 2025 medical-staff bylaws define Ascension Providence Hospital as the Southfield 16001 West Nine Mile Road and Novi 47601 Grand River Avenue campuses.',
    pointer_url: pointerUrl, pointer_http_status: pointer.status,
    pointer_sha256: pointer.sha256, pointer_observed_at: pointer.checkedAt,
    pricing_page_url: pricingUrl, pricing_page_http_status: pricing.status,
    pricing_page_sha256: pricing.sha256, pricing_page_observed_at: pricing.checkedAt,
    records, primary_campus: 'Southfield',
    limitation: 'One CCN names Southfield and Novi, and the current publisher supplies distinct first-party pointer entries and CSVs. Southfield is the roster/home-base address, not a substitute for the Novi file. Each CSV proof is a bounded header prefix, not complete-file validation or a legal verdict.' };
  const proofFile = 'reconciliation-providence-two-campus-proof.json';
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  ledger.records.push({ ccn, observed_at: records.map(row => row.observed_at).sort().at(-1),
    proof_file: proofFile, pointer_url: pointerUrl, pointer_sha256: pointer.sha256,
    primary_campus: 'Southfield', primary_mrf_url: records[0].mrf_url,
    primary_mrf_sample_sha256: records[0].retained_sha256,
    additional_campus: 'Novi', additional_mrf_url: records[1].mrf_url,
    additional_mrf_sample_sha256: records[1].retained_sha256,
    disposition: 'one-roster-ccn-two-current-publisher-campus-files-corroborated',
    next_action: 'Preserve both current Henry Ford campus files under CCN 230019, with Southfield as roster-address primary and Novi as a distinct additional file. Do not replace the combined hospital with only one campus; complete-file validation remains pending.' });
  ledger.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256,
    campus_samples: records.map(row => ({ campus: row.campus, sha256: row.retained_sha256 })) }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
