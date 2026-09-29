'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const rawDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const output = path.join(root, 'data/hpt-audit/reconciliation-franciscan-nebraska-proof.json');
const pointerUrl = 'https://www.franhealth.org/cms-hpt.txt';
const expectedMrf = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7971/470486026_franciscan-care-services_standardcharges.csv';
const sha256 = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
  fs.mkdirSync(rawDir, { recursive: true });
  const pointer = await retrieve(pointerUrl, 65536, { timeoutMs: 30000 });
  const pointerText = pointer.body.toString('utf8');
  if (pointer.status < 200 || pointer.status >= 300
      || !pointerText.includes('location-name: Franciscan Healthcare')
      || !pointerText.includes(`mrf-url: ${expectedMrf}`)) throw new Error('Franciscan pointer identity or MRF mismatch');
  const mrf = await retrieve(expectedMrf, 262144, { timeoutMs: 30000,
    headers: { Referer: 'https://search.hospitalpriceindex.com/' } });
  if (mrf.status < 200 || mrf.status >= 300 || mrf.body.length < 65536) throw new Error('Franciscan MRF retrieval failed');
  const parsed = await parsePayload(mrf.body, mrf.headers['content-type'] || '');
  const header = parsed.parsed.find(p => p.cmsVersion && p.mrfHospitalName && p.mrfAddress && p.mrfLicenseState);
  if (!header || header.cmsVersion !== '3.0.0' || header.mrfLicenseState !== 'NE'
      || !/Franciscan Healthcare/i.test(header.mrfLocationName || '')
      || !/430 N(?:orth)? Monitor/i.test(header.mrfAddress || '')) throw new Error('Franciscan root metadata mismatch');
  const samplePath = path.join(rawDir, `${mrf.sha256}.bin`);
  fs.writeFileSync(samplePath, mrf.body);
  const proof = {
    ccn: '281322', roster_name: 'ST FRANCIS MEMORIAL HOSPITAL', roster_address: '430 NORTH MONITOR ST',
    roster_city: 'WEST POINT', roster_state: 'NE', official_domain: 'franhealth.org',
    official_source_page: 'https://www.franhealth.org/patients-visitors/patient-financial-information.html?page=2',
    portal_url: 'https://search.hospitalpriceindex.com/hpi2/machineReadable/FranciscanHealthcare/7971or',
    pointer_url: pointerUrl, pointer_final_url: pointer.finalUrl, pointer_http_status: pointer.status,
    pointer_sha256: sha256(pointer.body), pointer_location_name: 'Franciscan Healthcare',
    mrf_url: expectedMrf, mrf_final_url: mrf.finalUrl, mrf_http_status: mrf.status,
    mrf_sha256: mrf.sha256, retained_bytes: mrf.body.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    total_file_bytes: Number((mrf.headers['content-range'] || '').split('/')[1]) || null,
    declared_hospital_name: header.mrfHospitalName, declared_location_name: header.mrfLocationName,
    declared_address: header.mrfAddress, declared_state: header.mrfLicenseState,
    declared_date: header.declaredLastUpdated, version: header.cmsVersion,
    file_kind: header.innerKind || header.fileKind, observed_at: mrf.checkedAt,
    disposition: 'verified-current-mrf-corrects-unrelated-pennsylvania-assignment',
    rejected_prior_identity: 'St Mary Rehabilitation Hospital, Langhorne Pennsylvania'
  };
  fs.writeFileSync(output, JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
