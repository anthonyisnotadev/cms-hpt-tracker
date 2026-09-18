'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { requestCapped, extractDeclared } = require('./lib/probe');

const root = path.resolve(__dirname, '../..');
const fileUrl = 'https://hospitalpricetransparencyfiles.com/nor-lea-district-hospital/850278235_Nor-Lea-Hospital-District_standardcharges.csv';
const expectedSampleSha = '0b6830467dee3e9f16f7584d7eadcd605ebb4922413dc6c5197d3568d7aa3832';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const response = await requestCapped(fileUrl, {
    timeoutMs: 25000, cap: 262144, headers: { Range: 'bytes=0-262143' }
  });
  const meta = extractDeclared(response.body, 'csv');
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'cms_data/hpt/roster.json'), 'utf8'))
    .find(row => row.ccn === '321305');
  if (!roster || roster.address !== '1600 NORTH MAIN AVE' || roster.state !== 'NM'
    || response.status !== 206 || response.body.length !== 262144
    || response.headers['content-range'] !== 'bytes 0-262143/11230287'
    || sha(response.body) !== expectedSampleSha
    || meta.hospitalName !== 'Nor-Lea Hospital District'
    || meta.locationName !== 'Nor-Lea Hospital District'
    || meta.address !== '1900 North Main Avenue, Lovington, NM 88260-2813'
    || meta.licenseState !== 'NM' || meta.raw !== '7/17/2026'
    || meta.version !== '3.0.0') throw new Error('Nor-Lea source or conflict proof changed');
  const sampleRelative = `cms_data/hpt/nationwide-verification/file-byte-proof/${expectedSampleSha}.bin`;
  const sampleAbsolute = path.join(root, sampleRelative);
  fs.mkdirSync(path.dirname(sampleAbsolute), { recursive: true });
  if (!fs.existsSync(sampleAbsolute)) fs.writeFileSync(sampleAbsolute, response.body);
  if (sha(fs.readFileSync(sampleAbsolute)) !== expectedSampleSha)
    throw new Error('Retained Nor-Lea sample hash mismatch');
  const proof = {
    ccn: roster.ccn, observed_at: new Date().toISOString(),
    roster: { name: roster.name, address: roster.address, city: roster.city,
      state: roster.state, zip: roster.zip },
    cms_enrollment_snapshot: 'data/hpt-audit/priority-one-cms-enrollment-snapshot-review.json',
    browser_observation: {
      browser: 'Codex in-app browser',
      first_party_page_url: 'https://nor-lea.org/resources',
      first_party_page_result: 'rendered',
      first_party_page_links_exact_file: true,
      first_party_page_address: '1600 N. Main, Lovington NM',
      pointer_requested_url: 'https://nor-lea.org/cms-hpt.txt',
      pointer_final_url: 'https://www.nlmktg.org/cms-hpttxt',
      pointer_result: 'marketing HTML page with pointer-style text, not a retained structured pointer',
      pointer_visible_file_url: fileUrl
    },
    direct_client_observation: {
      first_party_resources_http_status: 403,
      first_party_root_pointer_http_status: 403,
      note: 'These are client-access observations, not evidence that the first-party page or pointer is absent.'
    },
    file: { url: fileUrl, http_status: response.status,
      content_range: response.headers['content-range'], total_bytes: 11230287,
      retained_bytes: response.body.length, sample_sha256: expectedSampleSha,
      retained_sample: sampleRelative, declared_hospital_name: meta.hospitalName,
      declared_location_name: meta.locationName, declared_address: meta.address,
      declared_license_state: meta.licenseState, declared_date_raw: meta.raw,
      declared_date: '2026-07-17', template_version: meta.version },
    conclusion: 'First-party page links the candidate CSV, but the file declares 1900 N Main while current facility and exact-CCN sources say 1600 N Main. Pointer is not independently retrieved as a structured document. No promotion.'
  };
  fs.writeFileSync(path.join(root, 'data/hpt-audit/reconciliation-nor-lea-address-conflict-proof.json'),
    JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ ccn: proof.ccn, sample_sha256: expectedSampleSha,
    observed_at: proof.observed_at }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
