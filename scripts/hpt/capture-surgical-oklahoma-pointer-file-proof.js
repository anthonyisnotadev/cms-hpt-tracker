'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { curlGet, decode } = require('./lib/recovery-transport');
const { extractDeclared, toISODate } = require('./lib/probe');
const { parseCSV } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const ccn = '370201';
const pointerTarget = 'https://surgicalhospitalok.net/731521890_surgical-hospital-of-oklahoma-llc_standardcharges.csv';
const pageTarget = 'https://surgicalhospitalok.net/sho__2026_standard_charges__v1_0_0_tall__2026-08-17T16_41_17.728462979Z.csv';
const output = path.join(root, 'data/hpt-audit/reconciliation-surgical-oklahoma-pointer-file-proof.json');
const rawDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const sha = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
  const pointer = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/pointer-provenance-discrepancy-rechecks.json')))
    .records.find(row => row.ccn === ccn);
  if (!pointer || !pointer.retained_file || pointer.parsed_location_names.length !== 1
    || pointer.parsed_location_names[0] !== 'Surgical Hospital of Oklahoma') throw new Error('Fresh pointer proof missing');
  const file = await curlGet(pointerTarget, 262144, 20000, 4, {}, true);
  if (file.status !== 206 || file.body.length !== 262144 || !/^bytes 0-262143\//.test(file.headers['content-range'] || ''))
    throw new Error(`Unexpected bounded pointer-file response: ${file.status} ${file.body.length}`);
  const rows = parseCSV(decode(file.body));
  const head = rows[0] || [], values = rows[1] || [];
  const licenseIndex = head.findIndex(value => /^license_number\s*\|\s*KS$/i.test(String(value)));
  if (licenseIndex < 0 || String(values[licenseIndex] || '').trim()) throw new Error('License header/value changed');
  const declared = extractDeclared(file.body, 'csv');
  const digest = sha(file.body);
  fs.mkdirSync(rawDir, { recursive: true });
  const raw = path.join(rawDir, `${digest}.bin`);
  if (fs.existsSync(raw) && sha(fs.readFileSync(raw)) !== digest) throw new Error('Retained sample hash collision');
  if (!fs.existsSync(raw)) fs.writeFileSync(raw, file.body);
  const page = await curlGet(pageTarget, 8192, 15000, 4, {}, false);
  const proof = {
    ccn, observed_at: new Date().toISOString(),
    official_identity_page: 'https://surgicalhospitalok.net/',
    roster_and_official_address: '100 Southeast 59th Street, Oklahoma City, OK 73129',
    pointer_url: pointer.checked_url, pointer_sha256: pointer.response_sha256,
    pointer_observed_at: pointer.observed_at, pointer_retained_file: pointer.retained_file,
    pointer_location_name: 'Surgical Hospital of Oklahoma',
    pointer_source_page_url: 'https://surgicalhospitalok.net/price-transparency',
    pointer_mrf_url: pointerTarget, pointer_mrf_http_status: file.status,
    pointer_mrf_sample_bytes: file.body.length, pointer_mrf_sample_sha256: digest,
    pointer_mrf_sample_retained_file: path.relative(root, raw).replace(/\\/g, '/'),
    pointer_mrf_total_bytes_from_content_range: Number((file.headers['content-range'] || '').split('/')[1]),
    pointer_mrf_declared_hospital_name: declared.hospitalName,
    pointer_mrf_declared_location_name: declared.locationName,
    pointer_mrf_declared_address: declared.address,
    pointer_mrf_license_header: head[licenseIndex],
    pointer_mrf_license_value: String(values[licenseIndex] || ''),
    pointer_mrf_header_state_token: declared.licenseState,
    pointer_mrf_declared_date: toISODate(declared.raw),
    pointer_mrf_declared_version: declared.version,
    pricing_page_url: 'https://surgicalhospitalok.net/price-transparency/',
    pricing_page_mrf_link_url: pageTarget, pricing_page_mrf_link_http_status: page.status,
    disposition: 'current-pointer-file-readable-header-state-label-conflicts-with-oklahoma-page-link-404',
    interpretation: 'The current root pointer names a reachable CSV whose name and address match this Oklahoma facility. The metadata column label is license_number | KS, but its value is blank; KS is a header token, not a populated license value. The separate first-party pricing-page MRF link returned 404. Only a 262,144-byte sample was retained, so full-file usability and rate content are not established.',
    next_action: 'Ask the publisher to confirm or correct the license_number | KS header/blank license field and reconcile the pricing-page 404 link with the current root-pointer target. Then retrieve and validate the complete exact file before any verified-MRF finding; do not treat the KS header token as a populated license value or a legal conclusion.'
  };
  fs.writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ ccn, pointer_status: file.status, sample_sha256: digest,
    license_header: proof.pointer_mrf_license_header, license_value: proof.pointer_mrf_license_value,
    page_link_status: page.status }));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
