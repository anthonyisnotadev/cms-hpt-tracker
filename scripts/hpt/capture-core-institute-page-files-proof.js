'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://thecoreinstitutehospital.com/cms-hpt.txt';
const pageUrl = 'https://thecoreinstitutehospital.com/patients-visitors/billing-options/';
const identityUrl = 'https://thecoreinstitutehospital.com/';
const inpatientUrl = 'https://thecoreinstitutehospital.com/wp-content/uploads/2026/09/2026-THE-CORE-INSTITUTE-SPECIALTY-HOSPITAL-MRF-INPATIENT.csv';
const fullUrl = 'https://thecoreinstitutehospital.com/wp-content/uploads/2026/09/THE-CORE-INSTITUTE-SPECIALTY-HOSPITAL-STANDARDCHARGES.csv';

async function main() {
  const [pointer, page, identity, inpatient, full] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 262144, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(inpatientUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fullUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const $ = cheerio.load(page.body.toString('utf8'));
  const links = $('a').map((_, a) => ({ label: $(a).text().trim(),
    url: new URL($(a).attr('href') || '', pageUrl).href })).get();
  const identityText = identity.body.toString('utf8').toLowerCase();
  const inpatientHeader = (await parsePayload(inpatient.body, inpatient.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  const fullHeader = (await parsePayload(full.body, full.headers['content-type'] || '')).parsed
    .find(item => item.innerKind === 'csv');
  if (pointer.status !== 404 || ![200, 206].includes(page.status)
      || ![200, 206].includes(identity.status) || inpatient.status !== 206
      || full.status !== 206 || inpatient.body.length !== 13737 || full.body.length !== 262144
      || !links.some(link => link.label === '2026 Machine Readable File, Inpatient' && link.url === inpatientUrl)
      || !links.some(link => link.label === '2026 Machine Readable File, Full' && link.url === fullUrl)
      || !identityText.includes('6501 n 19th ave') || !identityText.includes('phoenix')
      || !identityText.includes('"addressregion": "az"')
      || !inpatientHeader || inpatientHeader.mrfHospitalName !== 'The CORE Institute Specialty Hospital'
      || inpatientHeader.mrfLocationName !== 'The CORE Institute Specialty Hospital'
      || inpatientHeader.mrfAddress !== '6501 N. 19th Ave, Phoenix, AZ, 85015'
      || inpatientHeader.mrfLicenseState !== 'AZ' || inpatientHeader.declaredLastUpdated !== '2026-04-27'
      || inpatientHeader.cmsVersion !== '3.0.0' || !fullHeader
      || fullHeader.mrfHospitalName || fullHeader.declaredLastUpdated || fullHeader.cmsVersion) {
    throw new Error('CORE root/page/identity or paired file evidence changed');
  }
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  for (const sample of [inpatient, full]) fs.writeFileSync(path.join(sampleDir, `${sample.sha256}.bin`), sample.body);
  const record = {
    ccn: '030108', official_domain: 'thecoreinstitutehospital.com',
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_response_has_pointer_style_text: /mrf-url:/i.test(pointer.body.toString('utf8')),
    source_page_url: pageUrl, source_page_sha256: page.sha256,
    official_identity_url: identityUrl, official_identity_sha256: identity.sha256,
    inpatient_url: inpatientUrl, inpatient_http_status: inpatient.status,
    inpatient_sha256: inpatient.sha256, inpatient_bytes: inpatient.body.length,
    inpatient_sample: path.relative(root, path.join(sampleDir, `${inpatient.sha256}.bin`)).replaceAll('\\', '/'),
    inpatient_declared_hospital_name: inpatientHeader.mrfHospitalName,
    inpatient_declared_location_name: inpatientHeader.mrfLocationName,
    inpatient_declared_address: inpatientHeader.mrfAddress,
    inpatient_declared_state: inpatientHeader.mrfLicenseState,
    inpatient_declared_date: inpatientHeader.declaredLastUpdated,
    inpatient_version: inpatientHeader.cmsVersion,
    full_url: fullUrl, full_http_status: full.status, full_sha256: full.sha256,
    full_bytes: full.body.length,
    full_sample: path.relative(root, path.join(sampleDir, `${full.sha256}.bin`)).replaceAll('\\', '/'),
    full_opening_metadata: 'no-hospital-name-date-or-version-in-bounded-opening',
    observed_at: inpatient.checkedAt,
    next_action: 'Recheck the root pointer after a publisher change; separately inspect the full CSV format and coverage. The readable inpatient CSV is page-linked and not evidence that the full file or root pointer is valid.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-core-institute-page-files-proof.json'),
    `${JSON.stringify({ disposition: 'root-404-page-linked-inpatient-and-full-csv', record }, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, root: record.pointer_http_status,
    inpatient_sample: record.inpatient_sha256, full_sample: record.full_sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
