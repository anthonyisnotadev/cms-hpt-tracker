'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'data/hpt-audit/reconciliation-jackson-montgomery-proof.json');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const officialPage = 'https://www.jackson.org/patient-resources/patients-visitors/price-transparency/';
const publisherPage = 'https://pricetransparency.accureg.net/jackson';
const pointer = 'https://www.jackson.org/cms-hpt.txt';
const pointerMrf = 'https://pricetransparency.blob.core.windows.net/jackson/63-6001820_Jackson-Hospital_standardcharges.csv?sv=2022-11-02&ss=bfqt&srt=sco&sp=rwdlacupiytfx&se=2099-04-26T22:40:35Z&st=2024-04-11T14:40:35Z&spr=https&sig=V53UDZpYxrVMzk1BKj4Dvm45q%2FAztzKKQCADbpBONqo%3D';
const currentMrf = 'https://cdn.accureg.net/trans/jackson/63-6001820_Jackson-Hospital_standardcharges.csv';

(async () => {
  fs.mkdirSync(sampleDir, { recursive: true });
  const [official, publisher, pointerResult, file] = await Promise.all([
    retrieve(officialPage, 524288, { timeoutMs: 30000 }),
    retrieve(publisherPage, 262144, { timeoutMs: 30000 }),
    retrieve(pointer, 65536, { timeoutMs: 30000 }),
    retrieve(currentMrf, 524288, { timeoutMs: 30000 }),
  ]);
  const officialText = official.body.toString('utf8');
  const publisherText = publisher.body.toString('utf8');
  const pointerText = pointerResult.body.toString('utf8');
  if (official.status < 200 || official.status >= 300 || !officialText.includes(publisherPage) || !officialText.includes('1725 Pine Street')) throw new Error('Jackson official identity/source link changed');
  if (publisher.status < 200 || publisher.status >= 300 || !publisherText.includes(currentMrf)) throw new Error('Jackson publisher file link changed');
  if (pointerResult.status < 200 || pointerResult.status >= 300 || !pointerText.includes(pointerMrf) || pointerText.includes(currentMrf)) throw new Error('Jackson pointer mismatch changed');
  const parsed = await parsePayload(file.body, file.headers['content-type'] || '');
  const header = parsed.parsed.find((item) => item.mrfHospitalName && item.mrfAddress && item.mrfLicenseState);
  if (file.status < 200 || file.status >= 300 || !header || header.mrfLicenseState !== 'AL' || header.cmsVersion !== '3.0.0' || header.declaredLastUpdated !== '2026-06-23' || !/Jackson Hospital/i.test(header.mrfHospitalName) || !/1725 Pine St/i.test(header.mrfAddress)) throw new Error('Jackson file proof incomplete');
  const samplePath = path.join(sampleDir, `${file.sha256}.bin`);
  fs.writeFileSync(samplePath, file.body);
  const record = {
    ccn: '010024',
    disposition: 'official-publisher-current-mrf-root-pointer-still-links-broken-signed-url',
    official_domain: 'jackson.org',
    official_page_url: officialPage,
    official_page_sha256: official.sha256,
    publisher_page_url: publisherPage,
    publisher_page_sha256: publisher.sha256,
    pointer_url: pointer,
    pointer_final_url: pointerResult.finalUrl,
    pointer_http_status: pointerResult.status,
    pointer_sha256: pointerResult.sha256,
    pointer_mrf_url: pointerMrf,
    current_mrf_url: currentMrf,
    current_mrf_http_status: file.status,
    current_mrf_sha256: file.sha256,
    retained_bytes: file.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    total_file_bytes: Number(file.headers['content-length']) || Number((file.headers['content-range'] || '').split('/')[1]) || null,
    declared_hospital_name: header.mrfHospitalName,
    declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress,
    declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated,
    version: header.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Retain the current official-publisher file and exact identity metadata, but do not call it pointer-linked while the root pointer continues to name the broken signed Azure URL. Recheck the pointer after a publisher update.',
  };
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
