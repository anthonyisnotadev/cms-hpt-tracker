'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { retrieve, parsePayload } = require('./lib/recovery-transport');
const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const ccn = '230031';
const pointerUrl = 'https://mylakehuron.com/cms-hpt.txt';
const mrfUrl = 'https://mylakehuron.com/wp-content/uploads/2026/09/1060000015_LakeHuronMedicalCenter_standardcharges.json';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'))).find(row => row.ccn === ccn);
  const nationwide = JSON.parse(fs.readFileSync(path.join(audit, 'nationwide-verification.json'))).records.find(row => row.ccn === ccn);
  const browser = JSON.parse(fs.readFileSync(path.join(audit, 'reconciliation-lake-huron-browser-access-observation.json')));
  const retainedPointer = fs.readFileSync(path.join(root, 'cms_data/hpt/pointer-corpus/raw/mylakehuron.com-351626c25224.txt'));
  const retainedFile = `cms_data/hpt/nationwide-verification/file-byte-proof/d6e8c80bb70e11e938726fb4a128afc4dec879957fa5fc60746d4c3eaa8848e8.bin`;
  const retainedBytes = fs.readFileSync(path.join(root, retainedFile));
  if (roster?.name !== 'LAKE HURON MEDICAL CENTER' || roster.address !== '2601 ELECTRIC AVENUE'
      || roster.state !== 'MI' || roster.zip !== '48060'
      || nationwide?.disposition !== 'verified-template-review' || nationwide.mrf_url !== mrfUrl
      || nationwide.standing_finding !== 'compliant-observed'
      || browser.ccn !== ccn || browser.site_browser_result !== 'rendered'
      || browser.site_visible_address !== '2601 Electric Ave Port Huron, MI 48060')
    throw new Error('Lake Huron baseline or browser identity changed');
  const [pointer, file] = await Promise.all([
    retrieve(pointerUrl, 65536, { timeoutMs: 30000 }),
    retrieve(mrfUrl, 262144, { timeoutMs: 45000 }),
  ]);
  const parsed = (await parsePayload(file.body, file.headers['content-type'] || 'application/json')).parsed
    .find(row => row.innerKind === 'json');
  if (pointer.status !== 206 || file.status !== 206 || file.body.length !== 262144
      || !pointer.body.equals(retainedPointer) || !file.body.equals(retainedBytes)
      || sha(pointer.body) !== '03f4d9e1b3d75681c33facc55497374770d43009a3b38522c217d1a7a9b12e32'
      || !pointer.body.toString('utf8').includes(`location-name: Lake Huron Medical Center`)
      || !pointer.body.toString('utf8').includes(`mrf-url: ${mrfUrl}`)
      || parsed?.mrfHospitalName !== 'Lake Huron Medical Center'
      || parsed.mrfLocationName !== 'Lake Huron Medical Center'
      || parsed.mrfAddress !== '2601 Electric Avenue Port Huron, MI  48060'
      || parsed.mrfLicenseState !== 'MI' || parsed.declaredLastUpdated !== '2026-09-01'
      || parsed.cmsVersion !== '3.0')
    throw new Error(`Lake Huron current root/file differs from retained proof: ${JSON.stringify({pointerStatus:pointer.status,fileStatus:file.status,parsed})}`);
  const proof = { ccn, roster_name: roster.name, roster_address: roster.address,
    browser_identity_observation: 'reconciliation-lake-huron-browser-access-observation.json',
    browser_site_observed_at: browser.observed_at,
    pointer_url: pointerUrl, pointer_http_status: pointer.status, pointer_sha256: pointer.sha256,
    pointer_observed_at: pointer.checkedAt, pointer_matches_retained_raw: true,
    mrf_url: mrfUrl, mrf_http_status: file.status, mrf_final_url: file.finalUrl,
    mrf_total_bytes: Number((file.headers['content-range'] || '').split('/')[1]) || null,
    retained_sample: retainedFile, retained_bytes: file.body.length, retained_sha256: file.sha256,
    file_observed_at: file.checkedAt, file_matches_retained_sample: true,
    declared_hospital_name: parsed.mrfHospitalName, declared_location_name: parsed.mrfLocationName,
    declared_address: parsed.mrfAddress, declared_license_state: parsed.mrfLicenseState,
    declared_date: parsed.declaredLastUpdated, declared_version: parsed.cmsVersion,
    prior_standing_mrf_url: nationwide.standing_mrf_url,
    limitation: 'A fresh exact-root and bounded September file recheck matches retained September bytes after a separate client/browser access challenge. The first-party browser identity observation is dated, not a fresh page retrieval. Literal version 3.0 needs review; full-file validity and legal compliance remain unverified.' };
  fs.writeFileSync(path.join(audit, 'reconciliation-lake-huron-current-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn, pointer_sha256: pointer.sha256, file_sha256: file.sha256 }));
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
