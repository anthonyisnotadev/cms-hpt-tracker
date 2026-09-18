'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const crypto = require('crypto');
const { retrieve, decode, parsePayload } = require('./lib/recovery-transport');
const { parseCSV } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '441322';
const pointerUrl = 'https://shamrock.health/cms-hpt.txt';
const pageUrl = 'https://shamrock.health/billing/';
const fileUrl = 'https://shamrock.health/downloads/862345211_Houston-County-Community-Hospital_standardcharges.csv';

async function main() {
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .find(row => row.ccn === ccn);
  const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'), 'utf8'))
    .records.find(row => row.ccn === ccn);
  const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const proofFile = 'reconciliation-houston-county-address-conflict-proof.json';
  if (roster?.name !== 'HOUSTON COUNTY COMMUNITY HOSPITAL'
      || roster.address !== '5001 EAST MAIN STREET' || roster.city !== 'ERIN'
      || roster.state !== 'TN' || roster.zip !== '37061'
      || nationwide?.disposition !== 'pointer-facility-match-unresolved'
      || ledger.records.some(row => row.ccn === ccn)
      || fs.existsSync(path.join(audit, proofFile)))
    throw new Error('Houston County roster, assessment, or reviewed ledger changed');

  const [pointer, page, file] = await Promise.all([
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 400000, { timeoutMs: 30000 }),
  ]);
  const safePointerLines = pointer.body.toString('utf8').split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const retainedPointer = fs.readFileSync(path.join(root,
    'cms_data/hpt/pointer-corpus/raw/shamrock.health-8f8443d5652a.txt'));
  const retainedPointerSha = crypto.createHash('sha256').update(retainedPointer).digest('hex');
  const retainedSafePointerLines = retainedPointer.toString('utf8').split(/\r?\n/).map(line => line.trim())
    .filter(line => /^(location-name|source-page-url|mrf-url):/.test(line));
  const obfuscation = JSON.parse(fs.readFileSync(path.join(audit, 'pointer-obfuscation.json'), 'utf8'));
  const obfuscationEntry = obfuscation.entries.find(row =>
    row.file.replaceAll('\\', '/').endsWith('/shamrock.health.txt'));
  const $ = cheerio.load(page.body.toString('utf8'));
  const pageLinks = $('a[href]').map((_, node) => new URL($(node).attr('href'), pageUrl).href).get();
  const total = Number((file.headers['content-range'] || '').split('/')[1]);
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed
    .find(item => item.innerKind === 'csv');
  const rows = parseCSV(decode(file.body));
  const widths = [...new Set(rows.map(row => row.length))];
  if (![200, 206].includes(pointer.status) || ![200, 206].includes(page.status)
      || file.status !== 206 || !total || file.body.length !== total
      || !safePointerLines.includes('location-name: Houston County Community Hospital')
      || !safePointerLines.includes(`mrf-url: ${fileUrl}`)
      || pointer.sha256 !== nationwide.pointer_corpus_sha256
      || obfuscationEntry?.plaintextSha256 !== pointer.sha256
      || obfuscationEntry?.storedSha256 !== retainedPointerSha
      || JSON.stringify(retainedSafePointerLines) !== JSON.stringify(safePointerLines)
      || !pageLinks.includes(fileUrl)
      || !page.body.toString('utf8').includes('5001 East Main Street, Erin, TN 37061')
      || parsed?.mrfHospitalName !== 'Houston County Community Hospital'
      || parsed.mrfLocationName !== 'Houston County Community Hopsital'
      || parsed.mrfAddress !== '200 West Church St, Lexington, TN 38351'
      || parsed.mrfLicenseState !== 'TN' || parsed.declaredLastUpdated !== '2026-06-30'
      || parsed.cmsVersion !== '3.0.0' || rows.length < 4 || widths.length !== 1)
    throw new Error(`Houston County evidence changed: ${JSON.stringify({ pointer: pointer.status,
      page: page.status, file: file.status, fileBytes: file.body.length, total,
      safePointerLines, hasFileLink: pageLinks.includes(fileUrl), parsed,
      csvRows: rows.length, widths })}`);

  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster.name, roster_address: roster.address, roster_city: roster.city,
    roster_state: roster.state, roster_zip: roster.zip,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    retained_pointer_sha256: retainedPointerSha,
    retained_pointer_obfuscated: true,
    pointer_safe_fields_same_as_retained: true,
    pointer_observed_at: pointer.checkedAt, pointer_entry_without_contacts: safePointerLines,
    first_party_pricing_page_url: pageUrl, pricing_page_http_status: page.status,
    pricing_page_sha256: page.sha256, pricing_page_observed_at: page.checkedAt,
    pricing_page_facility_address: '5001 East Main Street, Erin, TN 37061',
    pointer_and_page_file_url: fileUrl, file_http_status: file.status,
    file_total_bytes: total, retained_file: path.relative(root, samplePath).replaceAll('\\', '/'),
    retained_bytes: file.body.length, file_sha256: file.sha256,
    csv_rows: rows.length, columns_per_row: widths[0],
    file_declared_hospital_name: parsed.mrfHospitalName,
    file_declared_location_name: parsed.mrfLocationName,
    file_declared_address: parsed.mrfAddress,
    file_declared_license_state: parsed.mrfLicenseState,
    file_declared_date: parsed.declaredLastUpdated,
    file_declared_version: parsed.cmsVersion,
    observed_at: file.checkedAt,
    limitation: 'The pointer and first-party page link the same complete CSV, but its declared location/address says Lexington while the roster and first-party page say Erin. The file hospital-name field agrees, which does not resolve the campus conflict. Rate-level correctness and legal compliance were not adjudicated.',
  };
  fs.writeFileSync(path.join(audit, proofFile), JSON.stringify(proof, null, 2) + '\n');
  ledger.records.push({ ccn, observed_at: file.checkedAt, proof_file: proofFile,
    official_pricing_page: pageUrl, pointer_url: pointerUrl,
    pointer_mrf_url: fileUrl, page_file_url: fileUrl, complete_file_sha256: file.sha256,
    first_party_address: proof.pricing_page_facility_address,
    file_declared_address: parsed.mrfAddress, file_declared_location_name: parsed.mrfLocationName,
    file_declared_license_state: parsed.mrfLicenseState,
    file_declared_date: parsed.declaredLastUpdated, file_declared_version: parsed.cmsVersion,
    disposition: 'pointer-and-page-linked-file-hospital-name-matches-address-conflicts',
    next_action: 'Obtain a corrected publisher file or authoritative facility-specific explanation for the Lexington address and misspelled location name in the current pointer-and-page-linked CSV. Recheck exact CCN/campus identity before any facility MRF promotion; keep the complete-file conflict visible.' });
  ledger.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256,
    page_sha256: page.sha256, file_sha256: file.sha256,
    bytes: file.body.length, csv_rows: rows.length, columns: widths[0] }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
