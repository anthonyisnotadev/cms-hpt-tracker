'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'data/hpt-audit/reconciliation-greene-county-file-observation.json');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const officialPage = 'https://gcheutaw.com/price-listing';
const identityPage = 'https://gcheutaw.com/';
const pointer = 'https://gcheutaw.com/cms-hpt.txt';
const mrf = 'https://img1.wsimg.com/blobby/go/d55a8255-663e-4c01-a46d-aa8ff937d454/downloads/e90246cf-d114-46ff-a5c9-ee5dfa544c6d/PriceListing.csv?ver=1781540277319';

(async () => {
  fs.mkdirSync(sampleDir, { recursive: true });
  const [page, identity, pointerResult, file] = await Promise.all([
    retrieve(officialPage, 524288, { timeoutMs: 30000 }),
    retrieve(identityPage, 524288, { timeoutMs: 30000 }),
    retrieve(pointer, 262144, { timeoutMs: 30000 }),
    retrieve(mrf, 1048576, { timeoutMs: 30000 }),
  ]);
  const pageText = page.body.toString('utf8');
  const identityText = identity.body.toString('utf8');
  const fileText = file.body.toString('utf8').replace(/^\uFEFF/, '');
  if (page.status < 200 || page.status >= 300 || !pageText.includes(new URL(mrf).pathname)
      || !/Greene County Hospital/i.test(pageText)) throw new Error('Greene County pricing-page relationship changed');
  if (identity.status < 200 || identity.status >= 300 || !identityText.includes('509 Wilson Ave')
      || !/Eutaw/i.test(identityText)) throw new Error('Greene County official identity changed');
  if (pointerResult.status !== 404 || !String(pointerResult.headers['content-type'] || '').toLowerCase().includes('text/html')) {
    throw new Error('Greene County root pointer result changed');
  }
  if (file.status < 200 || file.status >= 300 || !fileText.includes('Greene County Health Systems')
      || !fileText.includes('Shoppable Services Worksheet') || !fileText.includes('Updated 5/31/22')) {
    throw new Error('Greene County legacy file content changed');
  }
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const declared = parsed.parsed[0] || {};
  if (declared.cmsVersion || declared.mrfHospitalName || declared.mrfAddress || declared.mrfLicenseState) {
    throw new Error('Greene County file now contains CMS root identity metadata; adjudicate separately');
  }
  const totalBytes = Number((file.headers['content-range'] || '').split('/')[1])
    || Number(file.headers['content-length']) || file.body.length;
  if (file.body.length !== totalBytes) throw new Error('Greene County CSV was not retained completely');
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '010051',
    disposition: 'official-page-linked-legacy-shoppable-csv-root-pointer-404',
    official_domain: 'gcheutaw.com',
    official_page_url: officialPage,
    official_page_sha256: page.sha256,
    identity_page_url: identityPage,
    identity_page_sha256: identity.sha256,
    official_page_relationship: 'The current official price-listing page names Greene County Hospital and links this exact CSV; the official home page gives the roster address at 509 Wilson Avenue, Eutaw, Alabama.',
    pointer_url: pointer,
    pointer_final_url: pointerResult.finalUrl,
    pointer_http_status: pointerResult.status,
    pointer_content_type: pointerResult.headers['content-type'] || '',
    pointer_sha256: pointerResult.sha256,
    pricing_resource_url: mrf,
    file_http_status: file.status,
    file_sha256: file.sha256,
    retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    total_file_bytes: totalBytes,
    schema_classification: 'legacy-custom-shoppable-services-csv',
    embedded_labelled_update_date: '2022-05-31',
    declared_hospital_name: null,
    declared_location_name: null,
    declared_address: null,
    declared_state: null,
    declared_date: null,
    version: null,
    observed_at: file.checkedAt,
    next_action: 'Keep this row unresolved. Recheck only after the official pricing-page file URL changes or a root cms-hpt.txt appears; require a current all-items-and-services CMS-template MRF with file-declared identity, address/state, date and version before promotion.',
  };
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
