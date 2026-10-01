'use strict';

// Bounded, hash-bound capture for Harsha Behavioral Center CCN 154054.
// Pointer text is parsed in memory; contact fields are never written to proof.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseCSV } = require('./lib/util');

const ROOT = path.resolve(__dirname, '../..');
const POINTER_URL = 'https://www.harshacenter.com/s/cms-hpt.txt';
const PAGE_URL = 'https://www.harshacenter.com/price-transparency/';
const PAGE_FILE_URL = 'https://www.harshacenter.com/s/261091197_harsha-behavioral-center_standardcharges-t8tx.csv';
const DECLARED_FILE_URL = 'https://www.harshacenter.com/s/261091197_harsha-behavioral-center_standardcharges.csv';
const sha = data => crypto.createHash('sha256').update(data).digest('hex');

async function get(url) {
  const response = await fetch(url, { headers: { Range: 'bytes=0-65535' }, signal: AbortSignal.timeout(20000) });
  return { response, bytes: Buffer.from(await response.arrayBuffer()) };
}

(async () => {
  const observedAt = new Date().toISOString();
  const [pointer, pointerFile, pageFile] = await Promise.all([
    get(POINTER_URL), get(DECLARED_FILE_URL), get(PAGE_FILE_URL)
  ]);
  const pointerText = pointer.bytes.toString('utf8');
  const pointerMap = Object.fromEntries(pointerText.split(/\r?\n/).map(line => {
    const i = line.indexOf(':'); return i < 0 ? ['', ''] : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
  }).filter(([key]) => key));
  const rows = parseCSV(pointerFile.bytes.toString('utf8'));
  const meta = rows[1] || [];
  const dataRows = rows.slice(3).filter(row => row.some(Boolean));
  const variableRows = dataRows.filter(row => row[13] || row[14]);
  const variableRowsWithAllowedAmounts = variableRows.filter(row => row[15] && row[16] && row[17] && row[18]);
  const fullRange = result => {
    const range = /^bytes\s+0-(\d+)\/(\d+)$/i.exec(result.response.headers.get('content-range') || '');
    return result.response.status === 206 && !!range && Number(range[1]) + 1 === result.bytes.length
      && Number(range[2]) === result.bytes.length;
  };
  const exact = pointerMap['mrf-url'] === new URL(DECLARED_FILE_URL).host + new URL(DECLARED_FILE_URL).pathname.replace(/^\//, '')
    || pointerMap['mrf-url'] === new URL(DECLARED_FILE_URL).host + new URL(DECLARED_FILE_URL).pathname;
  if (pointer.response.status !== 206 || !fullRange(pointer) || !exact
      || !fullRange(pointerFile) || !fullRange(pageFile)
      || !pointerFile.bytes.equals(pageFile.bytes)
      || pointerFile.response.url !== pageFile.response.url
      || meta[0] !== 'Harsha Behavioral Center' || meta[1] !== '7/1/2026' || meta[2] !== '3.0.0'
      || !/1980 E Woodsmall Drive\s+Terre Haute, IN 47802/i.test(meta[3] || '')
      || meta[4] !== '1594-003' || meta[5] !== 'Harsha Behavioral Center'
      || meta[7] !== '1891966065' || meta[8] !== 'TRUE'
      || dataRows.length === 0 || new Set(dataRows.map(row => row.length)).size !== 1
      || dataRows.some(row => row.length !== (rows[2] || []).length)
      || variableRows.length === 0 || variableRowsWithAllowedAmounts.length !== variableRows.length) {
    throw new Error('Harsha CMS MRF failed exact pointer, complete-range, identity, version, attestation, or row-width validation');
  }
  const digest = sha(pointerFile.bytes);
  const proofDir = path.join(ROOT, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(proofDir, { recursive: true });
  const retainedFile = path.join(proofDir, `${digest}.bin`);
  if (fs.existsSync(retainedFile)) {
    if (sha(fs.readFileSync(retainedFile)) !== digest) throw new Error('Existing retained file does not match the current digest');
  } else fs.writeFileSync(retainedFile, pointerFile.bytes, { flag: 'wx' });
  const proof = {
    ccn: '154054', observed_at: observedAt, evidence_role: 'current first-party pointer-linked MRF; exact CMS v3 metadata and full bytes',
    official_page_url: PAGE_URL, pointer_url: POINTER_URL, pointer_status: pointer.response.status,
    pointer_final_url: pointer.response.url, pointer_bytes: pointer.bytes.length,
    pointer_content_range: pointer.response.headers.get('content-range'), pointer_sha256: sha(pointer.bytes),
    pointer_declared_mrf_url: pointerMap['mrf-url'],
    page_linked_file_url: PAGE_FILE_URL, pointer_declared_file_url: DECLARED_FILE_URL,
    page_linked_file_status: pageFile.response.status, pointer_file_status: pointerFile.response.status,
    page_linked_final_url: pageFile.response.url, pointer_file_final_url: pointerFile.response.url,
    content_type: pointerFile.response.headers.get('content-type'), file_content_range: pointerFile.response.headers.get('content-range'),
    full_file_bytes: pointerFile.bytes.length, full_file_sha256: digest, retained_file: path.relative(ROOT, retainedFile).replaceAll('\\', '/'),
    declared_hospital_name: meta[0], declared_location_name: meta[5], declared_address: meta[3],
    declared_license_state: 'IN', declared_license_number: meta[4], declared_npi: meta[7],
    declared_last_updated: '2026-07-01', cms_template_version: meta[2], attestation: true,
    csv_header_columns: rows[2].length, parsed_data_rows: dataRows.length,
    csv_data_row_widths: [...new Set(dataRows.map(row => row.length))],
    row_checks: { description: dataRows.filter(row => row[0]).length, gross_charge: dataRows.filter(row => row[7]).length,
      payer: dataRows.filter(row => row[9]).length, negotiated_dollar: dataRows.filter(row => row[12]).length,
      usable_negotiated_charge: dataRows.filter(row => row[12] || row[13] || row[14]).length,
      percentage_or_algorithm_charge: variableRows.length,
      percentage_or_algorithm_with_median_percentiles_and_count: variableRowsWithAllowedAmounts.length },
    cms_v3_allowed_amount_check: { columns: ['median_amount', '10th_percentile', '90th_percentile', 'count'],
      applicable_rows: variableRows.length, complete_rows: variableRowsWithAllowedAmounts.length },
    alias_check: { same_final_url: pointerFile.response.url === pageFile.response.url,
      same_status: pointerFile.response.status === pageFile.response.status, same_bytes: pointerFile.bytes.equals(pageFile.bytes),
      same_sha256: sha(pointerFile.bytes) === sha(pageFile.bytes) },
    identity_gate: 'official-current-page-and-cms-pointer-link-the-exact-file; roster name/address/city/state agree; CSV facility/address/state/license/NPI agree',
    raw_pointer_contact_fields_omitted: true
  };
  const out = path.join(ROOT, 'data/hpt-audit/reconciliation-harsha-v3-current-pointer-proof-2026-09-30.json');
  fs.writeFileSync(out, JSON.stringify(proof, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ proof: path.relative(ROOT, out), retained_file: proof.retained_file,
    bytes: proof.full_file_bytes, sha256: digest, version: proof.cms_template_version, rows: proof.parsed_data_rows }) + '\n');
})().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
