const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const proofPath = path.join(audit, 'reconciliation-legent-orthopedic-current-mrf-full-proof-2026-09-27.json');
const mrfUrl = 'https://drive.google.com/uc?export=download&id=1toQm10puzBsJhiF4IUdMEbavJL1-RKMn';
const pageUrl = 'https://www.legenthealth.com/price-transparency';
const pointerUrl = 'https://www.legenthealth.com/cms-hpt.txt';
const maxBytes = 100_000_000;

function readCsvShape() {
  const decoder = new StringDecoder('utf8');
  const rows = [];
  let currentRow = [];
  let field = '';
  let inQuotes = false;
  let quotePending = false;
  let width = 0;
  let rowIndex = 0;
  let dataRows = 0;
  let malformedDataRows = 0;
  let actualColumns = 0;
  let nonEmptyDescriptionRows = 0;
  let rowsWithChargeValues = 0;
  let rowsWithCodeTypePairs = 0;
  let rowHasDescription = false;
  let rowHasCharge = false;
  const rowCodeFields = new Set();
  const rowCodeTypes = new Set();
  let fieldNonEmpty = false;
  let sawAnyInput = false;

  const endField = () => {
    if (rowIndex < 3) currentRow.push(field);
    const column = rows[2]?.[width] || '';
    if (rowIndex >= 3 && fieldNonEmpty) {
      if (column === 'description') rowHasDescription = true;
      if (column.startsWith('standard_charge|')) rowHasCharge = true;
      const code = column.match(/^code\|(\d+)$/);
      const codeType = column.match(/^code\|(\d+)\|type$/);
      if (code) rowCodeFields.add(code[1]);
      if (codeType) rowCodeTypes.add(codeType[1]);
    }
    field = '';
    fieldNonEmpty = false;
    width += 1;
  };
  const endRow = () => {
    endField();
    if (rowIndex < 3) rows.push(currentRow);
    if (rowIndex === 2) actualColumns = width;
    if (rowIndex >= 3) {
      dataRows += 1;
      if (width !== actualColumns) malformedDataRows += 1;
      if (rowHasDescription) nonEmptyDescriptionRows += 1;
      if (rowHasCharge) rowsWithChargeValues += 1;
      if ([...rowCodeFields].some((code) => rowCodeTypes.has(code))) rowsWithCodeTypePairs += 1;
      rowHasDescription = false;
      rowHasCharge = false;
      rowCodeFields.clear();
      rowCodeTypes.clear();
    }
    currentRow = [];
    width = 0;
    rowIndex += 1;
  };

  const write = (text) => {
    sawAnyInput ||= text.length > 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (inQuotes) {
        if (quotePending) {
          if (ch === '"') {
            if (rowIndex < 3) field += '"';
            fieldNonEmpty = true;
            quotePending = false;
            continue;
          }
          quotePending = false;
          inQuotes = false;
        } else if (ch === '"') {
          quotePending = true;
          continue;
        } else {
          if (rowIndex < 3) field += ch;
          if (!/\s/.test(ch)) fieldNonEmpty = true;
          continue;
        }
      }
      if (ch === '"' && field.length === 0) inQuotes = true;
      else if (ch === ',') endField();
      else if (ch === '\n') endRow();
      else if (ch !== '\r') {
        if (rowIndex < 3) field += ch;
        if (!/\s/.test(ch)) fieldNonEmpty = true;
      }
      if (field.length > 1_000_000) throw new Error('CSV metadata/header field exceeded the 1 MB cap');
    }
  };

  const finish = () => {
    write(decoder.end());
    if (quotePending) {
      quotePending = false;
      inQuotes = false;
    }
    if (inQuotes) throw new Error('Truncated CSV: unmatched quote at end of complete response');
    if (width > 0 || field.length > 0 || currentRow.length > 0 || (sawAnyInput && rowIndex === 0)) endRow();
    if (rows.length < 3) throw new Error(`Expected metadata, value and schema header rows; found ${rows.length}`);
    const rootKeys = rows[0];
    const rootValues = rows[1];
    const metadata = Object.fromEntries(rootKeys.map((key, index) => [key, rootValues[index] || '']));
    const dataHeaders = rows[2];
    return {
      metadata,
      headerColumnCount: actualColumns,
      dataRows,
      malformedDataRows,
      nonEmptyDescriptionRows,
      rowsWithChargeValues,
      rowsWithCodeTypePairs,
      requiredHeadersPresent: ['description', 'standard_charge|gross', 'standard_charge|discounted_cash', 'code|1', 'code|1|type']
        .every((name) => dataHeaders.includes(name))
    };
  };

  return { write: (buffer) => write(decoder.write(buffer)), finish };
}

async function main() {
  const head = spawnSync('curl.exe', ['-sSIL', '--max-time', '40', '-A', 'Mozilla/5.0', mrfUrl], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 1_000_000
  });
  if (head.status !== 0) throw new Error(`Publisher-file HEAD failed: ${head.stderr || head.error?.message || head.status}`);
  const headerBlocks = head.stdout.split(/\r?\n\r?\n/).filter(Boolean);
  const finalHeaders = headerBlocks.at(-1) || '';
  const statusMatch = finalHeaders.match(/^HTTP\/\S+\s+(\d+)/m);
  const status = Number(statusMatch?.[1] || 0);
  const headerValue = (name) => finalHeaders.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))?.[1]?.trim() || '';
  const declaredLength = Number(headerValue('content-length'));
  if (status !== 200) throw new Error(`Expected publisher-file HEAD HTTP 200, got ${status}`);
  if (!Number.isFinite(declaredLength) || declaredLength <= 0 || declaredLength > maxBytes) {
    throw new Error(`Refusing unexpected Content-Length: ${headerValue('content-length')}`);
  }

  const hash = crypto.createHash('sha256');
  const csv = readCsvShape();
  let total = 0;
  let trailer = '';
  let stderr = '';
  const child = spawn('curl.exe', [
    '-L', '--fail', '--silent', '--show-error', '--max-time', '180', '--max-filesize', String(maxBytes),
    '-A', 'Mozilla/5.0', '-w', '%{http_code}\\t%{url_effective}\\t%{size_download}\\t%{content_type}\\n', mrfUrl
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exitResult = new Promise((resolve) => child.once('close', (code) => resolve(code)));
  for await (const chunk of child.stdout) {
    const take = Math.max(0, Math.min(chunk.length, declaredLength - total));
    if (take > 0) {
      const body = chunk.subarray(0, take);
      total += take;
      if (total > maxBytes) {
        child.kill();
        throw new Error('Full-file stream exceeded the 100 MB cap');
      }
      hash.update(body);
      csv.write(body);
    }
    if (take < chunk.length) trailer += chunk.subarray(take).toString('utf8');
  }
  for await (const chunk of child.stderr) stderr += chunk.toString('utf8');
  const exitCode = await exitResult;
  if (exitCode !== 0) throw new Error(`Publisher-file stream failed (${exitCode}): ${stderr.trim()}`);
  if (total !== declaredLength) throw new Error(`Incomplete stream: received ${total} of ${declaredLength} bytes`);
  const transfer = trailer.trim().split('\t');
  if (Number(transfer[0]) !== 200 || Number(transfer[2]) !== total) {
    throw new Error(`Unexpected full-stream transfer metadata: ${trailer.trim()}`);
  }

  const shape = csv.finish();
  const lookup = shape.metadata;
  const attestationText = Object.entries(lookup).find(([key]) => key.toLowerCase().includes('to the best of its knowledge'))?.[1] || '';
  const proof = {
    ccn: '670265',
    observed_at: new Date().toISOString(),
    source_page_url: pageUrl,
    source_page_link_label: 'Legent Orthopedic Hospital Carrollton',
    source_page_mrf_url: mrfUrl,
    root_pointer_url: pointerUrl,
    root_pointer_final_url: 'https://cdn.prod.website-files.com/614a999fd87898600ee2bc39/679e924e7dc68343a1b102d8_a526a5804c68045151719dd254b06630_cms-hpt.txt',
    root_pointer_sha256: 'c0a59ec24d0faa7ebc665eab708895dcefeb39523f01b102f45ff4f27ccbe38c',
    retrieval: {
      method: 'full streamed GET with a 100 MB hard cap; no local MRF copy retained',
      status,
      final_url: transfer[1],
      content_type: headerValue('content-type'),
      content_length: declaredLength,
      bytes_received: total,
      content_disposition: headerValue('content-disposition'),
      last_modified: headerValue('last-modified'),
      sha256: hash.digest('hex')
    },
    declared_metadata: {
      hospital_name: lookup.hospital_name,
      last_updated_on: lookup.last_updated_on,
      version: lookup.version,
      location_name: lookup.location_name,
      hospital_address: lookup.hospital_address,
      type_2_npi: lookup.type_2_npi,
      license_number: lookup['license_number|TX'],
      license_state: 'TX',
      attestation_present: attestationText === 'TRUE'
    },
    csv_validation: {
      metadata_rows: 2,
      data_header_columns: shape.headerColumnCount,
      usable_data_rows: shape.dataRows,
      nonempty_description_rows: shape.nonEmptyDescriptionRows,
      rows_with_any_standard_charge_value: shape.rowsWithChargeValues,
      rows_with_a_code_type_pair: shape.rowsWithCodeTypePairs,
      malformed_row_widths: shape.malformedDataRows,
      required_wide_csv_headers_present: shape.requiredHeadersPresent,
      validation_scope: 'Full stream/hash and quote-aware CSV record/column-count and basic wide-template usability checks; not an exhaustive CMS schema validator or line-item accuracy review.'
    },
    current_cms_enrollment: {
      dataset_label: 'Hospital Enrollments : 2026-08-01',
      ccn: '670265',
      organization_name: 'ETHICUS HOSPITAL DFW LLC',
      doing_business_as_name: 'LEGENT ORTHOPEDIC HOSPITAL CARROLLTON',
      npi: '1316505043',
      address: '1401 E TRINITY MILLS RD, CARROLLTON, TX 75006',
      practice_location_type: 'MAIN/PRIMARY HOSPITAL LOCATION'
    },
    retained_historical_conflict: {
      older_cms_provider_roster_address: '4201 WILLIAM D TATE AVENUE, GRAPEVINE, TX 76051',
      interpretation: 'Preserve as older provider-roster evidence. The current 2026 enrollment, current first-party location page, and current MRF agree on the Carrollton location; this does not erase or independently date the older roster row.'
    },
    disposition: 'current-page-and-pointer-linked-mrf-observed-current-location-crosswalk-supported',
    count_effect: 0,
    limitations: [
      'This is observed publisher-file evidence, not a legal compliance determination.',
      'Current CMS enrollment and first-party sources corroborate the Carrollton CCN/NPI/location; the older Grapevine provider-roster observation is retained as history.',
      'The stream/CSV shape check does not substitute for an exhaustive CMS 3.0.0 schema validator or a line-item accuracy review.',
      'No personally identifying attester name is retained in this proof.'
    ],
    next_action: 'Reconcile the exact current header against CMS 3.0.0 schema validation and confirm tracker history preserves the older Grapevine roster observation as superseded/historical provenance; do not call legal compliance or line-item accuracy proven.'
  };

  if (shape.malformedDataRows !== 0 || shape.dataRows === 0 || !shape.requiredHeadersPresent
    || shape.nonEmptyDescriptionRows === 0 || shape.rowsWithChargeValues === 0 || shape.rowsWithCodeTypePairs === 0) {
    throw new Error(`CSV usability failed: ${JSON.stringify(shape)}`);
  }
  if (proof.declared_metadata.version !== '3.0.0' || proof.declared_metadata.type_2_npi !== '1316505043'
    || proof.declared_metadata.license_number !== '8742' || proof.declared_metadata.attestation_present !== true
    || !/Carrollton, TX,? 75006/i.test(proof.declared_metadata.hospital_address)) {
    throw new Error(`MRF metadata failed the current enrollment crosswalk: ${JSON.stringify(proof.declared_metadata)}`);
  }

  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ proof: path.relative(root, proofPath), ccn: proof.ccn, bytes: total, sha256: proof.retrieval.sha256, version: lookup.version, updated: lookup.last_updated_on, hospital: lookup.hospital_name, location: lookup.location_name, npi: lookup.type_2_npi, dataRows: shape.dataRows, malformedRowWidths: shape.malformedDataRows }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
