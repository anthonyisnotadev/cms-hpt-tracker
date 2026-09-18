'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'data/hpt-audit/reconciliation-community-tallassee-file-observation.json');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const officialPage = 'https://www.chal.org/about/resources';
const pointer = 'https://www.chal.org/cms-hpt.txt';
const mrf = 'https://www.chal.org/Community_Hospital_Machine_Readable_Standard_Charges_12_2020.csv';
const expectedColumns = [
  'CDM Item Number', 'Revenue Code', 'Service ID', 'Service Description', 'Gross Charge',
  'Discounted Cash Price', 'Minimum Negotiated Charge', 'Maximum Negotiated Charge',
];

(async () => {
  fs.mkdirSync(sampleDir, { recursive: true });
  const [page, pointerResult, file] = await Promise.all([
    retrieve(officialPage, 524288, { timeoutMs: 30000 }),
    retrieve(pointer, 65536, { timeoutMs: 30000 }),
    retrieve(mrf, 1048576, { timeoutMs: 30000 }),
  ]);
  const pageText = page.body.toString('utf8');
  const pointerText = pointerResult.body.toString('utf8');
  const fileText = file.body.toString('utf8').replace(/^\uFEFF/, '');
  const firstLine = fileText.split(/\r?\n/, 1)[0];
  if (page.status < 200 || page.status >= 300 || !pageText.includes(new URL(mrf).pathname)
      || !pageText.includes('805 Friendship Road') || !/Tallassee/i.test(pageText)) {
    throw new Error('Community Hospital official identity or file link changed');
  }
  if (pointerResult.status < 200 || pointerResult.status >= 300
      || !String(pointerResult.headers['content-type'] || '').toLowerCase().includes('text/html')
      || !/<html|<!doctype html/i.test(pointerText)) {
    throw new Error('Community Hospital root pointer is no longer an HTML soft misroute');
  }
  if (file.status < 200 || file.status >= 300 || !expectedColumns.every(column => firstLine.includes(column))) {
    throw new Error('Community Hospital legacy CSV schema changed');
  }
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const declared = parsed.parsed[0] || {};
  if (declared.declaredLastUpdated || declared.cmsVersion || declared.mrfHospitalName
      || declared.mrfLocationName || declared.mrfAddress || declared.mrfLicenseState) {
    throw new Error('Community Hospital file now contains CMS root metadata; adjudicate it separately');
  }
  const totalBytes = Number((file.headers['content-range'] || '').split('/')[1])
    || Number(file.headers['content-length']) || file.body.length;
  if (file.body.length !== totalBytes) throw new Error('Community Hospital CSV was not retained completely');
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '010034',
    disposition: 'official-page-linked-legacy-csv-root-pointer-soft-misroute',
    official_domain: 'chal.org',
    official_page_url: officialPage,
    official_page_relationship: 'The official Community Hospital resources page identifies 805 Friendship Road, Tallassee, Alabama and labels the exact CSV URL as its standard-charges file.',
    official_page_sha256: page.sha256,
    pointer_url: pointer,
    pointer_final_url: pointerResult.finalUrl,
    pointer_http_status: pointerResult.status,
    pointer_content_type: pointerResult.headers['content-type'] || '',
    pointer_classification: 'html-homepage-soft-misroute',
    pointer_sha256: pointerResult.sha256,
    pricing_resource_url: mrf,
    file_http_status: file.status,
    file_sha256: file.sha256,
    retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    total_file_bytes: totalBytes,
    schema_classification: 'legacy-custom-standard-charges-csv',
    observed_columns: expectedColumns,
    declared_hospital_name: null,
    declared_location_name: null,
    declared_address: null,
    declared_state: null,
    declared_date: null,
    version: null,
    observed_at: file.checkedAt,
    next_action: 'Keep this row unresolved. Ask the hospital to publish or identify a current CMS-template MRF and a valid root cms-hpt.txt pointer; if the linked file changes, retrieve it and require file-declared facility identity, address/state, date and template version before promotion.',
  };
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
