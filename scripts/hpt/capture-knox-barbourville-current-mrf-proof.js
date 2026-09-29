'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '181328';
const pointerUrl = 'https://arh.org/cms-hpt.txt';
const mrfUrl = 'https://www.arh.org/wp-content/uploads/2026/05/452696517_Barbourville-ARH-Hospital_standardcharges.csv';
const cmsUrl = `https://data.cms.gov/data-api/v1/dataset/3b5eae55-981c-4358-b3f8-7032d053d893/data?filter%5BCCN%5D=${ccn}&size=10`;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (quoted) throw new Error('CSV ended inside a quoted field');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return { response, bytes };
}

(async () => {
  const [{ response: pointerResponse, bytes: pointerBytes }, { response: fileResponse, bytes: fileBytes }, { response: cmsResponse, bytes: cmsBytes }] = await Promise.all([
    get(pointerUrl), get(mrfUrl), get(cmsUrl)
  ]);
  const pointerText = pointerBytes.toString('utf8');
  const pointerEntry = pointerText.split(/\r?\n/).filter(line => /Barbourville ARH Hospital/i.test(line));
  if (!pointerEntry.length || !pointerText.includes(mrfUrl)) throw new Error('Current ARH pointer does not link the exact Barbourville MRF URL');

  const rows = parseCsv(fileBytes.toString('utf8'));
  const header = rows[0];
  const meta = rows[1];
  if (!header || !meta || header.length !== meta.length) throw new Error('Missing or width-mismatched CMS metadata row');
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const dataRows = rows.slice(2).filter(row => row.some(value => value !== ''));
  const malformedRows = dataRows.reduce((count, row) => count + (row.length === header.length ? 0 : 1), 0);
  const cmsRows = JSON.parse(cmsBytes.toString('utf8'));
  const cms = cmsRows.find(row => row.CCN === ccn);
  if (cmsRows.length !== 1 || !cms) throw new Error(`Expected exactly one CMS enrollment row; received ${cmsRows.length}`);

  const proof = {
    ccn,
    observed_at: new Date().toISOString(),
    official_domain: 'arh.org',
    pointer_url: pointerUrl,
    pointer_status: pointerResponse.status,
    pointer_sha256: sha256(pointerBytes),
    pointer_bytes: pointerBytes.length,
    pointer_has_exact_facility_entry: true,
    pointer_entry_label: 'Barbourville ARH Hospital',
    mrf_url: mrfUrl,
    mrf_status: fileResponse.status,
    mrf_content_type: fileResponse.headers.get('content-type'),
    mrf_total_bytes: fileBytes.length,
    mrf_sha256: sha256(fileBytes),
    file_kind: 'csv',
    declared_hospital_name: meta[index.hospital_name],
    declared_last_updated: meta[index.last_updated_on],
    cms_template_version: meta[index.version],
    declared_location_name: meta[index.location_name],
    declared_address: meta[index.hospital_address],
    declared_license_number: meta['license_number|KY'],
    declared_license_state: 'KY',
    declared_npis: meta[index.type_2_npi],
    declared_attestation: Boolean(meta[index.attester_name] || meta[7]),
    columns: header.length,
    data_rows: dataRows.length,
    malformed_row_widths: malformedRows,
    cms_enrollment_dataset: 'Hospital Enrollments, July 2026 snapshot',
    cms_enrollment_query_url: cmsUrl,
    cms_enrollment_response_status: cmsResponse.status,
    cms_enrollment_response_sha256: sha256(cmsBytes),
    cms_enrollment_matches: {
      ccn: cms.CCN,
      npi: cms.NPI,
      dba: cms['DOING BUSINESS AS NAME'],
      organization: cms['ORGANIZATION NAME'],
      address: [cms['ADDRESS LINE 1'], cms.CITY, cms.STATE, cms['ZIP CODE']].join(', '),
      provider_type: cms['PROVIDER TYPE TEXT']
    },
    interpretation: 'Complete official pointer-linked CSV and exact CMS enrollment identity crosswalk. Structural CSV widths checked quote-aware. Observed file evidence only; not a legal compliance conclusion.'
  };
  if (malformedRows) throw new Error(`Found ${malformedRows} data rows with a width different from the ${header.length}-column header`);
  const output = path.join(audit, 'reconciliation-knox-barbourville-current-mrf-proof-2026-09-27.json');
  fs.writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ output, ccn, bytes: proof.mrf_total_bytes, columns: proof.columns, data_rows: proof.data_rows, malformed_row_widths: proof.malformed_row_widths, cms_npi: cms.NPI }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
