'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { requestCapped, extractDeclared } = require('./lib/probe');

const root = path.resolve(__dirname, '../..');
const pointerUrl = 'https://sheridanhospital.com/cms-hpt.txt';
const pageUrl = 'https://www.sheridanhospital.com/patient-portal/';
const fileUrl = 'https://sheridanhospital.com/wp-content/uploads/2026/04/381369796_sheridan-community-hospital_standardcharges.csv';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const get = async (url, cap, headers = {}) => {
  const response = await requestCapped(url, { timeoutMs: 25000, cap, headers });
  return { ...response, sha256: sha(response.body) };
};

async function main() {
  const [pointer, page, file] = await Promise.all([
    get(pointerUrl, 100000), get(pageUrl, 200000),
    get(fileUrl, 262144, { Range: 'bytes=0-262143' })
  ]);
  const declared = extractDeclared(file.body, 'csv');
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .find(row => row.ccn === '231312');
  if (!roster || roster.address !== '301 N MAIN ST' || roster.state !== 'MI'
    || pointer.status !== 200 || !/^text\/html/i.test(pointer.headers['content-type'] || '')
    || pointer.finalUrl !== 'https://www.sheridanhospital.com/cms-hpt.txt/'
    || !/^\s*<!doctype html/i.test(pointer.body.toString('utf8'))
    || page.status !== 200 || !page.body.includes(Buffer.from(fileUrl))
    || file.status !== 206 || file.body.length !== 262144
    || file.headers['content-range'] !== 'bytes 0-262143/68769805'
    || declared.hospitalName !== 'Sheridan Community Hospital'
    || declared.locationName !== 'Sheridan Community Hospital'
    || declared.address !== '301 N Main Street, Sheridan, MI, 48884'
    || declared.licenseState !== 'MI' || declared.raw !== '4/22/2026'
    || declared.version !== '3.0.0') throw new Error('Sheridan source, pointer or file proof changed');
  const retained = {};
  const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
  fs.mkdirSync(sampleDir, { recursive: true });
  for (const [role, capture] of Object.entries({ pointer, page, file })) {
    const relative = path.join('cms_data/hpt/nationwide-verification/file-byte-proof', `${capture.sha256}.bin`);
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) fs.writeFileSync(absolute, capture.body);
    if (sha(fs.readFileSync(absolute)) !== capture.sha256) throw new Error(`Retained ${role} hash mismatch`);
    retained[role] = relative.replaceAll('\\', '/');
  }
  const proof = { ccn: roster.ccn, observed_at: new Date().toISOString(),
    roster_name: roster.name, roster_address: roster.address, roster_city: roster.city,
    roster_state: roster.state, roster_zip: roster.zip,
    pointer: { url: pointerUrl, final_url: pointer.finalUrl, http_status: pointer.status,
      content_type: pointer.headers['content-type'], response_kind: 'html-page-not-pointer',
      sha256: pointer.sha256, bytes: pointer.body.length, retained_sample: retained.pointer },
    source_page: { url: pageUrl, http_status: page.status, sha256: page.sha256,
      bytes: page.body.length, exact_file_link_present: true, retained_sample: retained.page },
    file: { url: fileUrl, http_status: file.status, content_range: file.headers['content-range'],
      total_bytes: 68769805, retained_bytes: file.body.length, sample_sha256: file.sha256,
      retained_sample: retained.file, declared_hospital_name: declared.hospitalName,
      declared_location_name: declared.locationName, declared_address: declared.address,
      declared_license_state: declared.licenseState, declared_date_raw: declared.raw,
      declared_date: '2026-04-22', template_version: declared.version },
    conclusion: 'Current official page links an identity-matched CSV; root redirects to HTML, not a structured pointer. Full MRF not validated.' };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-sheridan-page-file-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: proof.ccn, pointer_kind: proof.pointer.response_kind,
    file_sample_sha256: proof.file.sample_sha256, observed_at: proof.observed_at }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
