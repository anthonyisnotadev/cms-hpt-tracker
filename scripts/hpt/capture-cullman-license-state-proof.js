'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://cullmanregional.com/cms-hpt.txt';
const mrfUrl = 'https://cullmanregional.com/wp-content/uploads/2025/01/631058174_cullman-regional-medical-center_standardcharges.csv';
const identityUrl = 'https://cullmanregional.com/patient-care/financial-services/';
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
async function get(url, headers = {}) { const response = await fetch(url, { headers }); return { response, body: Buffer.from(await response.arrayBuffer()) }; }
(async () => {
  const observedAt = new Date().toISOString();
  const [pointer, file, identity] = await Promise.all([get(pointerUrl), get(mrfUrl, { Range: 'bytes=0-1048575' }), get(identityUrl)]);
  if (!pointer.response.ok || ![200, 206].includes(file.response.status) || !identity.response.ok)
    throw new Error(`Capture failed: ${pointer.response.status}/${file.response.status}/${identity.response.status}`);
  const pointerText = pointer.body.toString('utf8'), fileText = file.body.toString('utf8'), identityText = identity.body.toString('utf8');
  if (!pointerText.includes('location-name: Cullman Regional Medical Center') || !pointerText.includes(mrfUrl)) throw new Error('Pointer changed');
  for (const token of ['license_number|CA', 'CULLMAN REGIONAL MEDICAL CENTER', '1912 AL Hwy 157, Cullman, AL 35056', '1/19/2026', '3.0.0'])
    if (!fileText.includes(token)) throw new Error(`File sample lacks ${token}`);
  for (const token of ['1912 Alabama Highway 157', 'Cullman, AL 35058']) if (!identityText.includes(token)) throw new Error(`Identity page lacks ${token}`);
  const sample = 'cms_data/hpt/nationwide-verification/file-byte-proof/cullman-license-state-010035.bin';
  fs.writeFileSync(path.join(root, sample), file.body);
  const proof = { ccn: '010035', observed_at: observedAt, pointer_url: pointerUrl, pointer_http_status: pointer.response.status,
    pointer_sha256: sha(pointer.body), mrf_url: mrfUrl, mrf_http_status: file.response.status, mrf_final_url: file.response.url,
    retained_sample: sample, retained_bytes: file.body.length, mrf_sample_sha256: sha(file.body),
    identity_page_url: identityUrl, identity_page_sha256: sha(identity.body), declared_hospital_name: 'CULLMAN REGIONAL MEDICAL CENTER',
    declared_location_name: 'Cullman Regional Hospital', declared_address: '1912 AL Hwy 157, Cullman, AL 35056',
    official_address: '1912 Alabama Highway 157, Cullman, AL 35058', declared_license_state: 'CA', facility_state: 'AL',
    declared_date: '2026-01-19', version: '3.0.0' };
  fs.writeFileSync(path.join(audit, 'reconciliation-cullman-license-state-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify(proof, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
