'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'data/hpt-audit/reconciliation-clay-county-html-pointer-proof.json');
const samples = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const identityUrl = 'https://www.claycountyhospital.com/getpage.php?name=contact';
const pointerUrl = 'https://claycountyhospital.com/cms-hpt.txt';
const pageUrl = 'https://www.claycountyhospital.com/getpage.php?name=Hospital_Pricing';
const fileUrl = 'https://www.claycountyhospital.com/docs/636002184_clay-county-hospital_standardcharges.csv.csv';
const sha = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
  fs.mkdirSync(samples, { recursive: true });
  const [identity, pointer, page, file] = await Promise.all([
    retrieve(identityUrl, 524288, { timeoutMs: 30000 }),
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(pageUrl, 524288, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 })
  ]);
  const identityText = identity.body.toString('utf8');
  const pointerText = pointer.body.toString('utf8');
  const pageText = page.body.toString('utf8');
  if (identity.status < 200 || identity.status >= 300 || !identityText.includes('Clay County Hospital')
      || !identityText.includes('83825 Hwy 9') || !identityText.includes('Ashland, Alabama 36251'))
    throw new Error('Clay County facility identity page changed');
  if (pointer.status < 200 || pointer.status >= 300 || !pointerText.includes('location-name: Clay County Hospital')
      || !pointerText.includes(`mrf-url: ${pageUrl}`) || pointerText.includes(fileUrl))
    throw new Error('Clay County pointer no longer labels the HTML page as its MRF');
  if (page.status < 200 || page.status >= 300 || !/text\/html/i.test(page.headers['content-type'] || '')
      || !pageText.includes('636002184_clay-county-hospital_standardcharges.csv.csv'))
    throw new Error('Clay County pricing page does not link the expected CSV');
  if (file.status < 200 || file.status >= 300 || file.body.length < 65536)
    throw new Error('Clay County CSV sample unavailable');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed?.find(item => item.cmsVersion && item.mrfHospitalName && item.mrfAddress);
  if (!header || header.cmsVersion !== '3.0.0' || header.mrfLicenseState !== 'AL'
      || header.declaredLastUpdated !== '2026-03-23'
      || !/Clay County\s+Healthcare Authority/i.test(header.mrfHospitalName)
      || !/Clay County Hospital/i.test(header.mrfLocationName)
      || !/83825 Highway 9.*Ashland, AL, 36251/i.test(header.mrfAddress))
    throw new Error('Clay County CSV identity or metadata mismatch');
  const digest = sha(file.body);
  const sample = path.join(samples, `${digest}.bin`);
  fs.writeFileSync(sample, file.body);
  const record = {
    ccn: '010073', disposition: 'pointer-mrf-url-is-html-page-linking-current-identity-matched-csv',
    official_domain: 'claycountyhospital.com', identity_url: identityUrl,
    identity_http_status: identity.status, identity_sha256: sha(identity.body),
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: sha(pointer.body),
    pointer_location_name: 'Clay County Hospital', pointer_mrf_url: pageUrl,
    page_http_status: page.status, page_content_type: page.headers['content-type'], page_sha256: sha(page.body),
    file_url: fileUrl, file_http_status: file.status, file_sha256: digest,
    retained_bytes: file.body.length, retained_sample: path.relative(root, sample).replaceAll('\\', '/'),
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Retain the page-linked file evidence, but do not call it directly pointer-linked. Recheck the exact pointer after a publisher change.'
  };
  fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: record.ccn, disposition: record.disposition, retained_bytes: record.retained_bytes }));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
