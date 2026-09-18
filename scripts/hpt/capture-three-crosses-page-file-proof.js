'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '320091';
const pointerUrl = 'https://threecrossesregional.com/cms-hpt.txt';
const pageUrl = 'https://www.threecrossesregional.com/price_transparency.html';
const fileUrl = 'https://www.threecrossesregional.com/assets/pdf/TCRH-Standard%20Charges-MRF-05.05.25.csv';

async function main() {
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .find(row => row.ccn === ccn);
  const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'))
    .records.find(row => row.ccn === ccn);
  const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (roster?.name !== 'THREE CROSSES REGIONAL HOSPITAL LLC'
      || roster.address !== '2560 SAMARITAN DRIVE' || roster.city !== 'LAS CRUCES'
      || roster.state !== 'NM' || roster.zip !== '88001'
      || nationwide?.disposition !== 'pointer-facility-match-unresolved'
      || ledger.records.some(row => row.ccn === ccn))
    throw new Error('Three Crosses roster, assessment, or observation ledger changed');

  const [pointer, page, file] = await Promise.all([
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const safePointerLines = pointer.body.toString('utf8').split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const $ = cheerio.load(page.body.toString('utf8'));
  const pageLinks = $('a[href]').map((_, node) => new URL($(node).attr('href'), pageUrl).href).get();
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed
    .find(item => item.innerKind === 'csv');
  if (![200, 206].includes(pointer.status) || ![200, 206].includes(page.status)
      || file.status !== 206 || file.body.length !== 262144
      || !safePointerLines.includes('location-name: Three Crosses Regional Hospital LLC')
      || !safePointerLines.includes(`mrf-url: ${pageUrl}`)
      || !pageLinks.includes(fileUrl)
      || parsed?.mrfHospitalName !== 'Three Crosses Regional Hospital LLC'
      || parsed.mrfLocationName !== 'Three Crosses Regional Hospital'
      || parsed.mrfAddress !== '2560  Samaritan Drive, Las Cruces, NM 88001'
      || parsed.mrfLicenseState !== 'CA' || parsed.declaredLastUpdated !== '2024-11-07'
      || parsed.cmsVersion !== '2.0.0')
    throw new Error(`Three Crosses evidence changed: ${JSON.stringify({ pointer: pointer.status, page: page.status, file: file.status, fileBytes: file.body.length, safePointerLines, hasFileLink: pageLinks.includes(fileUrl), parsed })}`);

  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster.name, roster_address: roster.address, roster_city: roster.city,
    roster_state: roster.state, roster_zip: roster.zip,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_observed_at: pointer.checkedAt, pointer_entry_without_contacts: safePointerLines,
    pointer_target_role: 'HTML price-transparency page, not CSV or JSON file',
    first_party_pricing_page_url: pageUrl, pricing_page_http_status: page.status,
    pricing_page_sha256: page.sha256, pricing_page_observed_at: page.checkedAt,
    pricing_page_file_url: fileUrl, file_http_status: file.status,
    file_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    retained_bytes: file.body.length, sample_sha256: file.sha256,
    file_declared_hospital_name: parsed.mrfHospitalName,
    file_declared_location_name: parsed.mrfLocationName,
    file_declared_address: parsed.mrfAddress,
    file_declared_license_state: parsed.mrfLicenseState,
    file_declared_date: parsed.declaredLastUpdated,
    file_declared_version: parsed.cmsVersion,
    observed_at: file.checkedAt,
    limitation: 'The root mrf-url points to an HTML page, while that page separately links a CSV. Only the first 262144 CSV bytes were retained. The CSV names the NM hospital and address but declares CA license state, 2024-11-07 update date, and 2.0.0 template version. Exact complete-file validity and current publisher intent are unverified; no clean MRF promotion or legal verdict.',
  };
  const proofFile = 'reconciliation-three-crosses-page-file-proof.json';
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  ledger.records.push({ ccn, observed_at: file.checkedAt, proof_file: proofFile,
    official_pricing_page: pageUrl, pointer_url: pointerUrl,
    pointer_target_url: pageUrl, pointer_target_role: 'HTML price-transparency page',
    page_file_url: fileUrl, page_file_sample_sha256: file.sha256,
    file_declared_address: parsed.mrfAddress, file_declared_license_state: parsed.mrfLicenseState,
    file_declared_date: parsed.declaredLastUpdated, file_declared_version: parsed.cmsVersion,
    disposition: 'first-party-page-file-identity-corroborated-but-pointer-target-html-and-license-state-conflict',
    next_action: 'Ask the publisher to identify the intended current CSV/JSON target for the root pointer and reconcile the CSV license state CA with the New Mexico hospital/address. Then retrieve and validate the complete exact file before promoting a current MRF claim. Preserve the HTML target and older date/version as observed metadata, not a legal verdict.' });
  ledger.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, page_sha256: page.sha256, sample_sha256: file.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
