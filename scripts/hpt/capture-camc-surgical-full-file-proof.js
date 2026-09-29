'use strict';

// Retain the complete, separately page-linked CAMC Surgical CSV for local audit.
// This does not make it the working root-pointer target or validate rate content.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { curlGet, decode } = require('./lib/recovery-transport');
const { extractDeclared, toISODate } = require('./lib/probe');
const { parseCSV } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const url = 'https://www.camc.org/sites/default/files/CSH/550526191_charleston-surgical-hospital%2C-llc_standardcharges.csv';
const expectedSha = '71e850ba0e23f97ec964ccbef54cfc37af268011844bdeda019dab40a90638b0';
const expectedBytes = 3421483;
const sample = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof', `${expectedSha}.bin`);

function validate(body) {
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  if (body.length !== expectedBytes || sha256 !== expectedSha)
    throw new Error('CAMC Surgical page file bytes changed; review before replacing retained evidence');
  const rows = parseCSV(decode(body));
  const widths = [...new Set(rows.map(row => row.length))];
  const parsed = extractDeclared(body, 'csv');
  if (rows.length !== 15344 || widths.length !== 1 || widths[0] !== 24
    || parsed.hospitalName !== 'CAMC Charleston Surgical Hospital'
    || parsed.locationName !== 'CAMC Charleston Surgical Hospital'
    || parsed.address !== '1306 Kanawha Blvd E, Charleston, WV, 25303'
    || parsed.licenseState !== 'WV' || toISODate(parsed.raw) !== '2026-04-14'
    || parsed.version !== '3.0.0')
    throw new Error('CAMC Surgical page file schema or root metadata changed');
  return { bytes: body.length, sha256, csv_rows: rows.length,
    service_rows_after_metadata_and_header: rows.length - 3, columns_per_row: widths[0],
    declared_date: toISODate(parsed.raw), declared_version: parsed.version,
    declared_hospital_name: parsed.hospitalName, declared_address: parsed.address,
    declared_license_state: parsed.licenseState };
}

async function main() {
  let body;
  if (fs.existsSync(sample)) body = fs.readFileSync(sample);
  else {
    const response = await curlGet(url, 4000000, 40000, 6, {}, false);
    if (response.status !== 200 || response.error) throw new Error(`CAMC Surgical file request: HTTP ${response.status} ${response.error}`);
    body = response.body;
  }
  const result = validate(body);
  if (!fs.existsSync(sample)) {
    fs.mkdirSync(path.dirname(sample), { recursive: true });
    fs.writeFileSync(sample, body);
  }
  console.log(JSON.stringify({ ...result, retained_file: path.relative(root, sample).replace(/\\/g, '/') }));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { validate, sample, url };
