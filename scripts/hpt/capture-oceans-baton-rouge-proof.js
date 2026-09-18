'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '194086';
const pointerUrl = 'https://oceanshealthcare.com/cms-hpt.txt';
const identityUrl = 'https://oceanshealthcare.com/financial-guidance/#price-transparency';
const fileUrl = 'https://oceanshealthcare.com/wp-content/uploads/2026/06/203890581_Oceans-Behavioral-Hosptial-of-Baton-Rouge-South_standardcharges.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8')).find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === ccn);
  const [pointer, identity, file] = await Promise.all([retrieve(pointerUrl, 262144, { timeoutMs: 30000 }), retrieve(identityUrl, 262144, { timeoutMs: 30000 }), retrieve(fileUrl, 262144, { timeoutMs: 30000 })]);
  const pointerText = pointer.body.toString('utf8');
  const pageText = identity.body.toString('utf8').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || '')).parsed.find(item => item.innerKind === 'csv');
  if (!roster || roster['Facility Name'] !== 'OCEANS BEHAVIORAL HOSPITAL OF BATON ROUGE' || roster.Address !== '11135 FLORIDA BLVD' || roster.State !== 'LA' || !base || base.finding !== 'compliant-observed'
    || ![200, 206].includes(pointer.status) || ![200, 206].includes(identity.status) || ![200, 206].includes(file.status) || file.body.length < 16384
    || !pointerText.includes('location-name: Oceans Behavioral Hospital of Baton Rouge South\nsource-page-url: https://oceanshealthcare.com/financial-guidance/#price-transparency\nmrf-url: ' + fileUrl)
    || parsed?.mrfHospitalName !== 'Oceans Behavioral Hosptial of Baton Rouge'
    || parsed.mrfLocationName !== 'Oceans Behavioral Hosptial of Baton Rouge' || parsed.mrfAddress !== '11135 Florida Boulevard; Baton Rouge, LA 70518'
    || parsed.mrfLicenseState !== 'LA' || parsed.declaredLastUpdated !== '2026-04-01' || parsed.cmsVersion !== '3.0.0') throw new Error('Oceans Baton Rouge evidence changed');
  const retainedSample = `cms_data/hpt/nationwide-verification/file-byte-proof/oceans-baton-rouge-${ccn}.bin`;
  fs.mkdirSync(path.dirname(path.join(root, retainedSample)), { recursive: true }); fs.writeFileSync(path.join(root, retainedSample), file.body);
  const proof = { ccn, roster_name: roster['Facility Name'], roster_address: roster.Address, roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'], source_page_url: identityUrl, source_page_sha256: identity.sha256, pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_location_name: 'Oceans Behavioral Hospital of Baton Rouge South', pointer_mrf_url: fileUrl, file_final_url: file.finalUrl, file_http_status: file.status, file_sample_sha256: file.sha256, file_sample_bytes: file.body.length, file_total_bytes: Number((file.headers['content-range'] || '').split('/').pop()), retained_sample: retainedSample, declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated, version: parsed.cmsVersion, observed_at: file.checkedAt, limitation: 'The live pointer separately declares an unsuffixed Baton Rouge entry whose file/page identify the Howell campus. This explicitly South-labelled Florida Boulevard entry matches the roster street but its declared ZIP is 70518 rather than the roster 70815; retain that literal address conflict. The complete file is not schema-validated and no legal compliance conclusion is made.' };
  fs.writeFileSync(path.join(audit, 'reconciliation-oceans-baton-rouge-proof.json'), `${JSON.stringify(proof, null, 2)}\n`); console.log(JSON.stringify({ ccn, retained_bytes: file.body.length, sha256: file.sha256 }));
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
