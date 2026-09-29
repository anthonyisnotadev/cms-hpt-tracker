'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { retrieve, decode } = require('./lib/recovery-transport');
const { parseCSV } = require('./lib/util');
const { extractDeclared, toISODate } = require('./lib/probe');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofPath = path.join(audit, 'reconciliation-coal-county-page-file-proof.json');
const ledgerPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const expectedSha = '5ed5ab1c5ca2a3ccfabbe18fade82e35f179dba472a818629edf4d7b04087dd9';
const expectedBytes = 3047626;
const samplePath = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof', `${expectedSha}.bin`);

async function main() {
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  const observation = ledger.records.find(row => row.ccn === '371319');
  if (proof.ccn !== '371319' || proof.file_total_bytes !== expectedBytes
      || proof.sample_sha256 !== 'c511dce1fa65b424fd329a760328264544920282b554ce54c5bdf4f769779610'
      || observation?.proof_file !== path.basename(proofPath)
      || observation.page_file_sample_sha256 !== proof.sample_sha256)
    throw new Error('Coal County bounded proof or reviewed observation changed');
  let body;
  let observedAt = proof.complete_file?.observed_at || null;
  if (fs.existsSync(samplePath)) body = fs.readFileSync(samplePath);
  else {
    const response = await retrieve(proof.pricing_page_file_url, 4000000, { timeoutMs: 35000 });
    const total = Number((response.headers['content-range'] || '').split('/')[1]);
    if (response.status !== 206 || total !== expectedBytes || response.body.length !== total)
      throw new Error(`Coal County complete file response changed: ${response.status}, ${response.body.length}/${total}`);
    body = response.body;
    observedAt = response.checkedAt;
  }
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  const prefixSha = crypto.createHash('sha256').update(body.subarray(0, 262144)).digest('hex');
  const rows = parseCSV(decode(body));
  const widths = [...new Set(rows.map(row => row.length))];
  const parsed = extractDeclared(body, 'csv');
  if (body.length !== expectedBytes || sha !== expectedSha || prefixSha !== proof.sample_sha256
      || rows.length !== 2254 || widths.length !== 1 || widths[0] !== 68
      || rows[0][0] !== 'hospital_name' || rows[2][0] !== 'description'
      || parsed.hospitalName !== proof.file_declared_hospital_name
      || parsed.locationName !== proof.file_declared_location_name
      || parsed.address !== proof.file_declared_address
      || parsed.licenseState !== proof.file_declared_license_state
      || toISODate(parsed.raw) !== proof.file_declared_date
      || parsed.version !== proof.file_declared_version)
    throw new Error('Coal County complete file hash, CSV shape, or metadata changed');
  if (!fs.existsSync(samplePath)) {
    fs.mkdirSync(path.dirname(samplePath), { recursive: true });
    fs.writeFileSync(samplePath, body);
  }
  proof.complete_file = {
    observed_at: observedAt, http_status: 206, bytes: body.length, sha256: sha,
    retained_file: path.relative(root, samplePath).replaceAll('\\', '/'),
    csv_rows: rows.length, service_rows_after_metadata_and_header: rows.length - 3,
    columns_per_row: widths[0],
    limitation: 'Complete bytes and rectangular CSV shape verified locally; individual rate values and legal compliance were not audited.',
  };
  proof.limitation = 'The current first-party page separately links a complete, byte-retained identity-matched CSV, but the root pointer targets a Google Sheets edit page. A pointer-to-CSV route and rate-level validity remain unverified; no legal compliance verdict.';
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n');
  observation.next_action = 'Resolve the root pointer to a direct CSV/JSON MRF target or document an official export chain to the complete, byte-retained page CSV. Keep the Google Sheets edit target and page-linked CSV as separate source roles; do not infer rate-level validity or legal compliance from rectangular CSV shape.';
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: proof.ccn, bytes: body.length, sha256: sha,
    csv_rows: rows.length, service_rows: rows.length - 3, columns: widths[0] }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
