'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseCSV } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const auditDir = path.join(root, 'data/hpt-audit');
const proofFile = path.join(auditDir, 'reconciliation-buchanan-general-current-pointer-proof-2026-09-30.json');
const rawDir = path.join(root, 'cms_data/hpt/nationwide-verification');
const pointerUrl = 'https://www.bgh.org/cms-hpt.txt';
const priorMrfUrl = 'https://www.bgh.org/docs/540895648_buchanan-general-hospital_standardcharges.csv';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const field = (header, row, name) => row[header.indexOf(name)] || '';

async function fetchBytes(url, headers = {}) {
  const response = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(120000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { response, bytes };
}

async function main() {
  const observedAt = new Date().toISOString();
  const pointer = await fetchBytes(pointerUrl);
  if (!pointer.response.ok) throw new Error(`Pointer HTTP ${pointer.response.status}`);
  const pointerText = pointer.bytes.toString('utf8');
  const publicPointerText = pointerText.replace(/^contact-(?:name|email):.*(?:\r?\n|$)/gim, '');
  const target = /^mrf-url:\s*(\S+)\s*$/im.exec(pointerText)?.[1];
  const location = /^location-name:\s*(.+?)\s*$/im.exec(pointerText)?.[1];
  const sourcePageUrl = /^source-page-url:\s*(\S+)\s*$/im.exec(pointerText)?.[1];
  if (!target || !location || location.trim() !== 'Buchanan General Hospital')
    throw new Error('Current root pointer did not retain the expected facility-specific MRF entry');
  const mrfUrl = new URL(target, pointer.response.url).href;
  const prior = await fetchBytes(priorMrfUrl);
  const mrf = await fetchBytes(mrfUrl);
  if (!mrf.response.ok) throw new Error(`MRF HTTP ${mrf.response.status}`);
  const lines = parseCSV(mrf.bytes.toString('utf8'));
  if (lines.length < 4) throw new Error('Current CSV does not contain metadata and charge rows');
  const header = lines[0].map(value => value.trim());
  const metadata = lines[1];
  const dataHeader = lines[2].map(value => value.trim());
  const rows = lines.slice(3).filter(row => row.some(value => value.trim()));
  const m = {
    hospital_name: field(header, metadata, 'hospital_name'),
    last_updated_on: field(header, metadata, 'last_updated_on'),
    version: field(header, metadata, 'version'),
    location_name: field(header, metadata, 'location_name'),
    hospital_address: field(header, metadata, 'hospital_address'),
    type_2_npi: field(header, metadata, 'type_2_npi'),
    'license_number|VA': field(header, metadata, 'license_number|VA'),
    attester_name: field(header, metadata, 'attester_name'),
    attestation: field(header, metadata, header[8])
  };
  const widths = [...new Set(rows.map(row => row.length))].sort((a, b) => a - b);
  const rowIndex = name => dataHeader.indexOf(name);
  const described = rows.filter(row => !!row[rowIndex('description')]?.trim()).length;
  const gross = rows.filter(row => !!row[rowIndex('standard_charge|gross')]?.trim()).length;
  const payerIndexes = dataHeader.map((name, index) => ({ name, index })).filter(item => item.name.startsWith('standard_charge|')
    && !['standard_charge|gross', 'standard_charge|discounted_cash'].includes(item.name));
  const negotiatedDollarIndexes = dataHeader.map((name, index) => ({ name, index }))
    .filter(item => item.name.startsWith('standard_charge|') && item.name.endsWith('|negotiated_dollar'));
  const rowsWithPayer = rows.filter(row => payerIndexes.some(item => !!row[item.index]?.trim())).length;
  const rowsWithNegotiatedDollar = rows.filter(row => negotiatedDollarIndexes.some(item => !!row[item.index]?.trim())).length;
  const payer = payerIndexes.length > 0;
  const sourceAddress = m.hospital_address.replaceAll('"', '');
  const complete = mrf.response.status === 200 && !!m.version && rows.length > 0 && widths.length === 1
    && described === rows.length && gross === rows.length;

  fs.mkdirSync(rawDir, { recursive: true });
  const pointerRaw = path.join(rawDir, 'buchanan-general-cms-hpt.txt');
  const mrfRaw = path.join(rawDir, 'buchanan-general-current-standardcharges.csv');
  fs.writeFileSync(pointerRaw, pointer.bytes);
  fs.writeFileSync(mrfRaw, mrf.bytes);
  const proof = {
    schema_version: 1,
    ccn: '490127',
    hospital_name: 'BUCHANAN GENERAL HOSPITAL',
    observed_at: observedAt,
    sources: {
      pointer: { url: pointerUrl, final_url: pointer.response.url, http_status: pointer.response.status,
        bytes: pointer.bytes.length, sha256: sha256(pointer.bytes), raw_artifact: path.relative(root, pointerRaw),
        text: publicPointerText },
      official_pricing_page: { url: sourcePageUrl || '', linked_from_pointer: true },
      prior_target: { url: priorMrfUrl, observed_http_status: prior.response.status,
        response_bytes: prior.bytes.length, response_sha256: sha256(prior.bytes),
        reason: 'Compare the previously recorded manifest URL with the exact current pointer target; preserve the old response as provenance.' },
      current_mrf: { url: mrfUrl, final_url: mrf.response.url, http_status: mrf.response.status,
        content_type: mrf.response.headers.get('content-type') || '', bytes: mrf.bytes.length,
        sha256: sha256(mrf.bytes), raw_artifact: path.relative(root, mrfRaw), ...m }
    },
    structure: { csv_header_columns: header.length, charge_header_columns: dataHeader.length,
      data_rows: rows.length, row_widths: widths, rows_with_description: described,
      rows_with_gross_charge: gross, rows_with_payer: rowsWithPayer,
      rows_with_negotiated_dollar: rowsWithNegotiatedDollar,
      payer_charge_column_present: payer, full_file_retrieved: true,
      cms_validator_run: false },
    identity_review: { pointer_location_name: location.trim(), roster_ccn: '490127',
      official_facility_name: 'Buchanan General Hospital', state: 'VA',
      official_address: '1535 Slate Creek Road, Grundy, VA 24614',
      file_name_agrees: m.hospital_name.toLowerCase() === 'buchanan general hospital',
      file_location_agrees: m.location_name.toLowerCase() === 'buchanan general hospital',
      file_address_agrees: /1535 Slate Creek Road, Grundy, VA,? 24614/i.test(sourceAddress),
      file_state_agrees: m['license_number|VA'] === 'H 1835',
      file_npi: m.type_2_npi },
    evidence_gain: 'Current first-party pointer bytes now link a new 2026-09-02 CMS 3.0.0 CSV URL; the prior corpus target returns 404. Full current file bytes, hash and parse summary are retained. This is newly retrieved pointer/file evidence, not a compliance determination.',
    disposition_effect: 'Do not promote to verified-current-mrf until CMS v3 validation succeeds. Replace the false unresolved pointer-to-facility linkage with reviewed current pointer/file evidence; retain any validator/compliance question separately.',
    next_action: 'Run the CMS validator against v3.0 using the retained full file, record exact validator version/output, then reconcile all applicable v3 fields before any verified-current-mrf finding.'
  };
  if (!complete || m.version !== '3.0.0' || m.last_updated_on !== '9/2/2026'
      || m.hospital_name !== 'Buchanan General Hospital' || !proof.identity_review.file_address_agrees
      || proof.identity_review.file_state_agrees !== true || !payer)
    throw new Error(`Current Buchanan file did not pass identity/metadata/structure gates: ${JSON.stringify({ metadata: m, identity: proof.identity_review, structure: proof.structure, conditions: { complete, date: m.last_updated_on === '9/2/2026', version: m.version === '3.0.0', payer } })}`);
  fs.writeFileSync(proofFile, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ proof: path.relative(root, proofFile), ccn: proof.ccn,
    pointerSha256: proof.sources.pointer.sha256, mrfUrl, mrfBytes: mrf.bytes.length,
    mrfSha256: proof.sources.current_mrf.sha256, metadata: m,
    structure: proof.structure, identity: proof.identity_review }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
