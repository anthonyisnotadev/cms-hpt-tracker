'use strict';

const fs = require('fs');
const path = require('path');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '060009';
const pointerUrl = 'https://intermountainhealthcare.org/cms-hpt.txt';
const identityUrl = 'https://intermountainhealthcare.org/locations/intermountain-health-lutheran-hospital';
const fileUrl = 'https://intermountainhealthcare.org/sc10media/files/intermountain-health/locations/hospital-prices/841103606_lutheran-medical-center_standardcharges.ashx';

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === ccn);
  const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8'))
    .find(row => row.ccn === ccn);
  const [pointer, identity, file] = await Promise.all([
    retrieve(pointerUrl, 262144, { timeoutMs: 30000 }),
    retrieve(identityUrl, 262144, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 35000 }),
  ]);
  const pointerText = pointer.body.toString('utf8');
  const identityText = identity.body.toString('utf8').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/octet-stream')).parsed
    .find(item => item.innerKind === 'csv');
  if (roster?.Address !== '8300 W 38TH AVE' || roster.State !== 'CO'
      || base?.finding !== 'compliant-observed'
      || ![200, 206].includes(pointer.status) || ![200, 206].includes(identity.status)
      || ![200, 206].includes(file.status) || file.body.length < 65536
      || !pointerText.includes('location-name: Intermountain Health Lutheran Hospital')
      || !pointerText.includes(`mrf-url: ${fileUrl}`)
      || !identityText.includes('12911 West 40th Avenue')
      || parsed?.mrfHospitalName !== 'INTERMOUNTAIN FRONT RANGE INC. DBA INTERMOUNTAIN HEALTH LUTHERAN HOSPITAL'
      || parsed.mrfAddress !== '12911 W 40TH AVE, WHEAT RIDGE, CO 80401'
      || parsed.mrfLicenseState !== 'CO' || parsed.declaredLastUpdated !== '2026-03-22'
      || parsed.cmsVersion !== '3.0.0') throw new Error('Lutheran relocation evidence changed');
  const relativeSample = `cms_data/hpt/nationwide-verification/file-byte-proof/lutheran-relocation-${ccn}.bin`;
  const samplePath = path.join(root, relativeSample);
  fs.mkdirSync(path.dirname(samplePath), { recursive: true });
  fs.writeFileSync(samplePath, file.body);
  const proof = {
    ccn, roster_name: roster['Facility Name'], former_roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    pointer_url: pointerUrl, pointer_sha256: pointer.sha256, pointer_http_status: pointer.status,
    source_page_url: 'https://intermountainhealthcare.org/locations/intermountain-health-lutheran-hospital/about/hospital-pricing',
    identity_page_url: identityUrl, identity_page_sha256: identity.sha256, identity_page_http_status: identity.status,
    relocation_statement: 'The current first-party page identifies Lutheran Hospital at 12911 West 40th Avenue; Intermountain publicly states the new hospital replaced the prior Lutheran Medical Center off 38th Avenue in August 2024.',
    mrf_url: fileUrl, mrf_final_url: file.finalUrl, mrf_http_status: file.status,
    retained_sample: relativeSample, retained_bytes: file.body.length, mrf_sample_sha256: file.sha256,
    archive_member: parsed.member, declared_hospital_name: parsed.mrfHospitalName,
    declared_location_name: parsed.mrfLocationName, declared_address: parsed.mrfAddress,
    declared_license_state: parsed.mrfLicenseState, declared_date: parsed.declaredLastUpdated,
    version: parsed.cmsVersion, observed_at: file.checkedAt,
    limitation: 'Only a bounded file prefix was retained. The relocation bridge supports current campus identity but does not validate the complete file or establish a legal compliance conclusion.'
  };
  fs.writeFileSync(path.join(audit, 'reconciliation-lutheran-relocation-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ ccn, retained_bytes: file.body.length, sample_sha256: file.sha256 }));
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
