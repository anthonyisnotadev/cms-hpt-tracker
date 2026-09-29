'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { parsePointer } = require('./lib/parse');
const { retrieve, parsePayload } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://multicare.org/cms-hpt.txt';
const fileUrl = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8063/911352172-1356528269_multicare-deaconess-hospital_standardcharges.csv';
const cmsUrl = 'https://www.cms.gov/medicare/medicare-general-information/medicareapprovedfacilitie/carotid-artery-stenting-facilities-items/deaconess-medical-center';
const dohUrl = 'https://doh.wa.gov/newsroom/department-health-issues-notice-intent-issue-civil-fines-licenses-acute-care-hospitals-0';
const stateCrosswalkUrl = 'https://doh.wa.gov/sites/default/files/legacy/Documents/2300/2020/CN21-39.pdf';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const roster = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/Hospital_General_Information.csv'), 'utf8'))
    .find(row => row['Facility ID'] === '500044');
  if (roster?.['Facility Name'] !== 'DEACONESS MEDICAL CENTER'
      || roster.Address !== 'W 800 FIFTH AVENUE' || roster['City/Town'] !== 'SPOKANE'
      || roster.State !== 'WA' || roster['ZIP Code'] !== '99210')
    throw new Error('Deaconess roster changed');
  const rows = csvToObjects(fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv'), 'utf8'));
  const currentHash = '7981ae2ab16b08e52b2e8eb1120a3176f1d751b3d780b2499318b00a55b7273e';
  const matches = rows.filter(row => row.pointer_url === pointerUrl && row.pointer_sha256 === currentHash
    && row.mrf_url === fileUrl && row.record_status === 'ok');
  if (matches.length !== 2 || !matches.some(row => row.location_name === 'MultiCare Deaconess Hospital')
      || !matches.some(row => row.location_name === 'MultiCare Deaconess North Emergency Center'))
    throw new Error('Current MultiCare Deaconess pointer rows changed');
  const pointerBytes = fs.readFileSync(path.join(root, matches[0].raw_file));
  const entries = parsePointer(pointerBytes.toString('utf8')).entries;
  if (sha(pointerBytes) !== currentHash || entries.length !== 19
      || entries.filter(entry => entry.mrfUrl === fileUrl).length !== 2)
    throw new Error('Retained current MultiCare pointer bytes changed');
  const [cms, doh, file] = await Promise.all([
    retrieve(cmsUrl, 524288, { timeoutMs: 30000 }),
    retrieve(dohUrl, 524288, { timeoutMs: 30000 }),
    retrieve(fileUrl, 262144, { timeoutMs: 30000 }),
  ]);
  const cmsText = cms.body.toString('utf8'), dohText = doh.body.toString('utf8');
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'text/csv')).parsed
    .find(item => item.innerKind === 'csv' && item.mrfHospitalName);
  if (cms.status !== 200 || cms.sha256 !== '35d1e1cd09d39f2ac6b330d3051fe78aaacf79096f955702b938f8aab0beee6c'
      || !cmsText.includes('Deaconess Medical Center') || !cmsText.includes('500044')
      || doh.status < 200 || doh.status >= 300
      || doh.sha256 !== '7576846119caa37ae7215a26b2c55dd09b8c122da4b1725bebdf44226faa932f'
      || !dohText.includes('MultiCare Deaconess Hospital') || !dohText.includes('800 W. 5th Ave')
      || file.status !== 206 || file.body.length !== 262144
      || file.headers['content-range'] !== 'bytes 0-262143/1139157133'
      || file.sha256 !== '70da95db720fb8f12f978bd0f5746207bf45e698e90dd17c9af512f7c70844a4'
      || parsed?.mrfHospitalName !== 'MultiCare Deaconess Hospital'
      || !parsed.mrfLocationName.includes('MultiCare Deaconess Hospital')
      || !parsed.mrfAddress.includes('800 West Fifth Avenue, Spokane, WA 99204')
      || parsed.mrfLicenseState !== 'WA' || parsed.declaredLastUpdated !== '2026-08-27'
      || parsed.cmsVersion !== '3.0.0')
    throw new Error('Deaconess CMS/DOH pages or bounded file header changed: ' + JSON.stringify({
      cmsStatus: cms.status, cmsSha: cms.sha256, cmsName: cmsText.includes('Deaconess Medical Center'),
      cmsCcn: cmsText.includes('500044'), dohStatus: doh.status, dohSha: doh.sha256,
      dohName: dohText.includes('MultiCare Deaconess Hospital'), dohStreet: dohText.includes('800 W. 5th Ave'),
      fileStatus: file.status, fileRange: file.headers['content-range'], fileBytes: file.body.length,
      fileSha: file.sha256, parsed,
    }));
  const retainedDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(retainedDir, { recursive: true });
  const retainedSample = path.join(retainedDir, `${file.sha256}.bin`);
  fs.writeFileSync(retainedSample, file.body);
  const proof = {
    ccn: '500044', roster_name: roster['Facility Name'], roster_address: roster.Address,
    roster_city: roster['City/Town'], roster_state: roster.State, roster_zip: roster['ZIP Code'],
    pointer_url: pointerUrl, pointer_sha256: currentHash, pointer_entry_count: entries.length,
    pointer_location_name: 'MultiCare Deaconess Hospital', pointer_mrf_url: fileUrl,
    cms_legacy_name_page_url: cmsUrl, cms_legacy_name_page_sha256: cms.sha256,
    cms_legacy_name_page_status: cms.status, cms_legacy_name_observed_at: cms.checkedAt,
    doh_current_campus_page_url: dohUrl, doh_current_campus_page_sha256: doh.sha256,
    doh_current_campus_page_status: doh.status, doh_current_campus_observed_at: doh.checkedAt,
    doh_current_campus_address: '800 W. 5th Ave., Spokane, WA 99204-2803',
    doh_ccn_crosswalk_document_url: stateCrosswalkUrl,
    doh_ccn_crosswalk_document_observation: 'Washington DOH CN21-39 Table 1 lists MultiCare Deaconess Hospital, 800 West 5th Ave Spokane WA 99204, Medicare Provider Number 500044.',
    mrf_url: fileUrl, file_http_status: file.status, file_sample_sha256: file.sha256,
    file_sample_bytes: file.body.length, file_total_bytes: 1139157133,
    retained_sample: path.relative(root, retainedSample).replaceAll('\\', '/'),
    declared_hospital_name: parsed.mrfHospitalName,
    declared_location_names: parsed.mrfLocationName,
    declared_addresses: parsed.mrfAddress,
    declared_primary_address: '800 West Fifth Avenue, Spokane, WA 99204',
    declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, version: parsed.cmsVersion,
    observed_at: file.checkedAt,
    next_action: 'Validate the remaining 1.139 GB CSV, including rate rows and the separate North Emergency Center location. Recheck the exact current pointer entry after a publisher change; do not infer legal compliance from the bounded header.',
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-multicare-deaconess-alias-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: proof.ccn, pointer_sha256: currentHash,
    file_sample_sha256: file.sha256, cms_page_sha256: cms.sha256, doh_page_sha256: doh.sha256 }));
}

if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
