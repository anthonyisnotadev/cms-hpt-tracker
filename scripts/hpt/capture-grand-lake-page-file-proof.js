'use strict';

// Capture only bounded first-party evidence; never download the entire MRF.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { requestCapped, extractDeclared } = require('./lib/probe');

const root = path.resolve(__dirname, '../..');
const pageUrl = 'https://grandlakehealth.org/patients-visitors/price-transparency/';
const pointerUrl = 'https://grandlakehealth.org/cms-hpt.txt';
const fileUrl = 'https://grandlakehealth.org/wp-content/uploads/2026/08/34-1623770_grand-lake-health-system_standardcharges.csv';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const observe = async (url, cap, headers = {}) => {
  const response = await requestCapped(url, { timeoutMs: 25000, cap, headers });
  return { ...response, sha256: sha(response.body) };
};

async function main() {
  const [pointer, page, file] = await Promise.all([
    observe(pointerUrl, 200000), observe(pageUrl, 500000),
    observe(fileUrl, 262144, { Range: 'bytes=0-262143' })
  ]);
  const declared = extractDeclared(file.body, 'csv');
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .find(row => row.ccn === '360032');
  if (!roster || roster.address !== '200 SAINT CLAIR STREET' || roster.state !== 'OH'
    || pointer.status !== 200 || !/^text\/html/i.test(pointer.headers['content-type'] || '')
    || !/^\s*<!doctype html/i.test(pointer.body.toString('utf8'))
    || page.status !== 200 || !page.body.includes(Buffer.from(fileUrl))
    || file.status !== 206 || file.body.length !== 262144
    || file.headers['content-range'] !== 'bytes 0-262143/21434893'
    || declared.hospitalName !== 'Grand Lake Health System'
    || declared.locationName !== 'Grand Lake Health System'
    || declared.address !== '200 Saint Clair Street, Saint Marys, OH 45885'
    || declared.licenseState !== 'OH' || declared.raw !== '2026-04-01'
    || declared.version !== '3.0.0') throw new Error('Grand Lake source, pointer or file proof changed');
  fs.mkdirSync(sampleDir, { recursive: true });
  const retained = {};
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
    pointer: { url: pointerUrl, http_status: pointer.status, content_type: pointer.headers['content-type'],
      response_kind: 'html-page-not-pointer', sha256: pointer.sha256, bytes: pointer.body.length,
      retained_sample: retained.pointer },
    source_page: { url: pageUrl, http_status: page.status, sha256: page.sha256,
      bytes: page.body.length, exact_file_link_present: true, retained_sample: retained.page },
    file: { url: fileUrl, http_status: file.status, content_range: file.headers['content-range'],
      total_bytes: 21434893, retained_bytes: file.body.length, sample_sha256: file.sha256,
      retained_sample: retained.file, declared_hospital_name: declared.hospitalName,
      declared_location_name: declared.locationName, declared_address: declared.address,
      declared_license_state: declared.licenseState, declared_date: declared.raw,
      template_version: declared.version },
    conclusion: 'Current official page links an identity-matched CSV; root returns HTML, not a structured pointer. Full MRF not validated.' };
  const output = path.join(root, 'data/hpt-audit/reconciliation-grand-lake-page-file-proof.json');
  fs.writeFileSync(output, JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: proof.ccn, pointer_kind: proof.pointer.response_kind,
    file_sample_sha256: proof.file.sample_sha256, observed_at: proof.observed_at }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
