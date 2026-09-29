'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '161329';
const aboutUrl = 'https://jcrhc.org/about-us/';
const contactUrl = 'https://jcrhc.org/contact-us/';
const pricingUrl = 'https://jcrhc.org/price-transparency/';
const pointerUrl = 'https://jcrhc.org/cms-hpt.txt';
const pointerFileUrl = 'https://jcrhc.org/wp-content/uploads/426037868_jackson-county-regional-health-center_standardcharges.csv';
const pageFileUrl = 'https://jcrhc.org/wp-content/uploads/426037868_jackson-county-public-hospital_standardcharges.xlsx';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  if (roster?.['Facility Name'] !== 'JACKSON COUNTY REGIONAL HEALTH CENTER'
      || roster.Address !== '700 W GROVE ST' || roster['City/Town'] !== 'MAQUOKETA'
      || roster.State !== 'IA' || roster['ZIP Code'] !== '52060'
      || base?.finding !== 'pointer-lists-no-mrf-url' || base.pointer_url !== pointerUrl)
    throw new Error('Jackson County roster or prior assessment changed');
  const [about, contact, pricing, pointer, pointerFile, pageFile] = await Promise.all([
    retrieve(aboutUrl, 262144, { timeoutMs: 30000 }),
    retrieve(contactUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pricingUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pointerFileUrl, 262144, { timeoutMs: 35000 }),
    retrieve(pageFileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const text = result => cheerio.load(result.body.toString('utf8'))('body').text().replace(/\s+/g, ' ');
  const $pricing = cheerio.load(pricing.body.toString('utf8'));
  const pageLinks = $pricing('a').map((_, node) => $pricing(node).attr('href')).get();
  const pointerLines = pointer.body.toString('utf8').split(/\r?\n/).map(line => line.trim());
  const parsed = (await parsePayload(pointerFile.body, pointerFile.headers['content-type'] || 'text/csv')).parsed
    .find(item => item.innerKind === 'csv');
  const pageParsed = (await parsePayload(pageFile.body, pageFile.headers['content-type'] || 'application/octet-stream')).parsed;
  if ([about, contact, pricing, pointer, pointerFile, pageFile].some(result => ![200, 206].includes(result.status))
      || !text(about).includes('opened our brand-new facility')
      || !text(contact).includes('601 Hospital Drive')
      || !text(contact).includes('Maquoketa, Iowa 52060')
      || !pageLinks.includes(pageFileUrl)
      || pointerLines.some(line => line.startsWith('mrf-url:'))
      || !pointerLines.includes(`mfr-url: ${pointerFileUrl}`)
      || pointerFile.body.length !== 262144 || pageFile.body.length !== 262144
      || parsed?.mrfHospitalName !== 'JACKSON COUNTY REGIONAL HEALTH CENTER'
      || parsed.mrfAddress !== '601 HOSPITAL DRIVE, MAQUOKETA, IA 52060'
      || parsed.mrfLicenseState !== 'IA' || parsed.declaredLastUpdated !== '2025-07-29'
      || parsed.cmsVersion !== '2.0.0' || pageParsed.length !== 0)
    throw new Error('Jackson County relocation, page/pointer split, or bounded file findings changed');
  const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (ledger.records.some(row => row.ccn === ccn)) throw new Error('Existing Jackson County observation requires manual review');
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const pointerSample = path.join(sampleDir, `${pointerFile.sha256}.bin`);
  const pageSample = path.join(sampleDir, `${pageFile.sha256}.bin`);
  fs.writeFileSync(pointerSample, pointerFile.body);
  fs.writeFileSync(pageSample, pageFile.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address,
    first_party_about_url: aboutUrl, first_party_about_sha256: about.sha256,
    first_party_contact_url: contactUrl, first_party_contact_sha256: contact.sha256,
    first_party_pricing_url: pricingUrl, first_party_pricing_sha256: pricing.sha256,
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256,
    pointer_location_name: 'Jackson County Regional Health Center',
    pointer_misspelled_label: 'mfr-url', pointer_has_mrf_url: false,
    pointer_file_url: pointerFileUrl, pointer_file_status: pointerFile.status,
    pointer_file_total_bytes: Number((pointerFile.headers['content-range'] || '').split('/')[1]) || null,
    pointer_file_retained_bytes: pointerFile.body.length,
    pointer_file_sample: path.relative(root, pointerSample).replaceAll('\\', '/'),
    pointer_file_sample_sha256: pointerFile.sha256,
    pointer_file_declared_name: parsed.mrfHospitalName,
    pointer_file_declared_address: parsed.mrfAddress, pointer_file_declared_state: parsed.mrfLicenseState,
    pointer_file_declared_date: parsed.declaredLastUpdated, pointer_file_declared_version: parsed.cmsVersion,
    pricing_page_file_url: pageFileUrl, pricing_page_file_status: pageFile.status,
    pricing_page_file_total_bytes: Number((pageFile.headers['content-range'] || '').split('/')[1]) || null,
    pricing_page_file_retained_bytes: pageFile.body.length,
    pricing_page_file_sample: path.relative(root, pageSample).replaceAll('\\', '/'),
    pricing_page_file_sample_sha256: pageFile.sha256,
    pricing_page_file_bounded_metadata: 'not parsed from first 262144 bytes of xlsx',
    observed_at: pointerFile.checkedAt,
    limitation: 'The roster has the older 700 W Grove address; first-party current pages and the CSV name the 601 Hospital Drive facility. The root pointer uses mfr-url, not mrf-url, and its 2025-07-29 v2.0.0 CSV differs from the page-linked XLSX. Only bounded file prefixes were retained; XLSX metadata and complete files are unverified. No clean MRF promotion or legal verdict.',
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-jackson-county-pointer-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  ledger.records.push({ ccn, observed_at: pointerFile.checkedAt,
    proof_file: 'reconciliation-jackson-county-pointer-proof.json',
    facility_role: 'same-named-hospital-at-current-601-hospital-drive-campus',
    official_pricing_page: pricingUrl, pointer_url: pointerUrl,
    pointer_issue: 'mfr-url-label-not-mrf-url', pointer_file_url: pointerFileUrl,
    pointer_file_sample_sha256: pointerFile.sha256,
    pointer_file_declared_date: parsed.declaredLastUpdated, pointer_file_declared_version: parsed.cmsVersion,
    pricing_page_file_url: pageFileUrl, pricing_page_file_sample_sha256: pageFile.sha256,
    disposition: 'current-campus-corroborated-but-pointer-label-malformed-and-page-file-different',
    next_action: 'Obtain publisher correction of mfr-url to mrf-url and reconcile the pointer CSV with the page-linked XLSX. Parse bounded workbook metadata via a ZIP-member-aware reader or obtain an official CSV/JSON, then validate full file content. Preserve the older roster address as historical; do not treat the 2025-07-29 v2.0.0 pointer CSV as a current clean claim.' });
  ledger.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_file_sample_sha256: pointerFile.sha256,
    page_file_sample_sha256: pageFile.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
