'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '340004';
const pointerUrl = 'https://wakehealth.edu/cms-hpt.txt';
const identityUrl = 'https://www.wakehealth.edu/patient-and-family-resources/preparing-for-your-visit/high-point-medical-center/contact-us';
const fileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/11240/560532309_high-point-regional-health_standardcharges.csv';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === ccn);
  const [pointer, identity, file] = await Promise.all([
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 45000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const identityText = identity.body.toString('utf8').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream')).parsed.find(item => item.innerKind === 'csv');
  if (!roster || roster['Facility Name'] !== 'HIGH POINT REGIONAL HEALTH SYSTEM' || roster.Address !== '601 N ELM ST' || roster.State !== 'NC'
    || !base || base.finding !== 'compliant-observed' || ![200, 206].includes(pointer.status) || ![200, 206].includes(identity.status)
    || ![200, 206].includes(file.status) || file.body.length < 65536
    || !pointerText.includes('location-name: Atrium Health Wake Forest Baptist Health High Point Medical Center')
    || !pointerText.includes(`mrf-url: ${fileUrl}`) || !identityText.includes('601 N Elm Street')
    || parsed?.mrfHospitalName !== 'High Point Regional Health' || parsed.mrfLocationName !== 'High Point Medical Center|High Point Regional Rehab'
    || !parsed.mrfAddress.includes('601 N Elm St') || parsed.mrfLicenseState !== 'NC' || parsed.declaredLastUpdated !== '2025-10-08' || parsed.cmsVersion !== '3.0.0') {
    throw new Error('High Point former-name evidence changed');
  }
  const relativeSample = `cms_data/hpt/nationwide-verification/file-byte-proof/high-point-alias-${ccn}.bin`;
  fs.mkdirSync(path.dirname(path.join(root, relativeSample)), { recursive: true });
  fs.writeFileSync(path.join(root, relativeSample), file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], roster_address: roster.Address, roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    identity_page_url: identityUrl, identity_page_sha256: identity.sha256, identity_page_address: '601 N Elm Street, High Point, NC 27262',
    historical_name_statement: 'Wake Forest states that High Point Regional Health became Wake Forest Baptist Health - High Point Medical Center in 2018; the current contact page identifies High Point Medical Center at the roster campus.',
    pointer_url: pointerUrl, pointer_final_url: pointer.finalUrl, pointer_sha256: pointer.sha256, pointer_location_name: 'Atrium Health Wake Forest Baptist Health High Point Medical Center', pointer_mrf_url: fileUrl,
    mrf_final_url: file.finalUrl, file_http_status: file.status, file_sample_sha256: file.sha256, file_sample_bytes: file.body.length, file_total_bytes: Number((file.headers['content-range'] || '').split('/').pop()), retained_sample: relativeSample,
    declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated, version: parsed.cmsVersion, observed_at: file.checkedAt,
    limitation: 'Only a bounded CSV prefix was retained. The alias and exact campus evidence does not validate the complete file or establish a legal compliance conclusion.'
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-high-point-alias-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ ccn, retained_bytes: file.body.length, sample_sha256: file.sha256 }));
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
