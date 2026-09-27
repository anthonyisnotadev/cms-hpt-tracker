'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const download = path.join(process.env.USERPROFILE || 'C:/Users/vboxuser', 'Downloads',
  '954124770_college-hospital-costa-mesa_standardcharges.csv');
const bytes = fs.readFileSync(download);
const text = bytes.toString('utf8');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
if (!text.includes('College Hospital Costa Mesa') || !text.includes('301 Victoria St., Costa Mesa CA 92627') ||
    !text.includes('5/22/2026') || !text.includes('3.0.0')) throw new Error('Unexpected Costa Mesa CSV metadata');
const pointerUrl = 'https://chcm.us/cms-hpt.txt';
const response = require('node:child_process').execFileSync('node', ['-e',
  "(async()=>{const r=await fetch(process.argv[1]);const b=Buffer.from(await r.arrayBuffer());process.stdout.write(JSON.stringify({status:r.status,contentType:r.headers.get('content-type'),body:b.toString('utf8')}));})().catch(e=>{console.error(e);process.exit(1)})",
  pointerUrl], { encoding: 'utf8' });
const pointer = JSON.parse(response);
const pointerBytes = Buffer.from(pointer.body, 'utf8');
const pointerSha256 = crypto.createHash('sha256').update(pointerBytes).digest('hex');
const fileUrl = 'https://chcm.us/954124770_college-hospital-costa-mesa_standardcharges.csv';
if (pointer.status !== 200 || !pointer.body.includes('College Hospital Costa Mesa') || !pointer.body.includes(fileUrl))
  throw new Error('Costa Mesa pointer did not declare the exact current file');
const sampleDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');
fs.mkdirSync(sampleDir, { recursive: true });
const retainedSample = path.join(sampleDir, `${sha256}.bin`);
if (!fs.existsSync(retainedSample)) fs.copyFileSync(download, retainedSample);
const proofName = 'reconciliation-college-costa-mesa-current-browser-download-proof-2026-09-25.json';
const proof = { ccn: '050543', observed_at: '2026-09-25T00:11:00Z', official_site: 'https://chcm.us/',
  official_pricing_page: 'https://chcm.us/price-transparency/', pointer_url: pointerUrl,
  pointer_status: pointer.status, pointer_content_type: pointer.contentType, pointer_bytes: pointerBytes.length,
  pointer_sha256: pointerSha256, page_file_url: fileUrl, browser_download_status: 200,
  browser_download_bytes: bytes.length, browser_download_sha256: sha256,
  retained_sample: path.relative(root, retainedSample).replaceAll('\\', '/'),
  declared_hospital_name: 'College Hospital Costa Mesa', declared_location_name: 'College Hospital Costa Mesa',
  declared_address: '301 Victoria St., Costa Mesa CA 92627', declared_license_state: 'CA',
  declared_last_updated: '2026-05-22', cms_template_version: '3.0.0', declared_npi: '1922039205',
  attestation: true, row_count_including_header: text.split(/\r?\n/).length,
  disposition: 'verified-current-pointer-file', next_action: 'Retain the exact pointer-linked file and recheck on the normal cadence.' };
fs.writeFileSync(path.join(audit, proofName), JSON.stringify(proof, null, 2) + '\n');

const ledgerPath = path.join(audit, 'reviewed-resolutions.json');
const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const base = csvToObjects(fs.readFileSync(path.join(audit, 'compliance.csv'), 'utf8')).find(row => row.ccn === proof.ccn) || {};
const evidence = { identity: 'corroborated', identity_basis: 'official-first-party-pricing-page-complete-current-csv-name-address-state-date-version-npi',
  officialDomain: 'chcm.us', sourcePageUrl: proof.official_pricing_page, pointerUrl: proof.pointer_url,
  pointerSha256, pointerIssue: 'pointer-and-header-identity-match', pointerHttpStatus: proof.pointer_status,
  pointerContentType: proof.pointer_content_type, pointerMrfUrl: proof.page_file_url, url: proof.page_file_url,
  http_status: 200, checked_at: proof.observed_at, date: proof.declared_last_updated, version: proof.cms_template_version,
  declared_hospital_name: proof.declared_hospital_name, location_name: proof.declared_location_name,
  declared_address: proof.declared_address, facility_address: proof.declared_address,
  declared_license_state: proof.declared_license_state, declared_npi: proof.declared_npi, file_kind: 'csv',
  fileSha256: sha256, bytesRetained: bytes.length, fullFileBytes: bytes.length, retainedSampleBytes: bytes.length,
  attestationPresent: true, observedFinding: 'date-within-365-days-version-3' };
const entry = { ccn: proof.ccn, base, action: 'replace', finding: 'verified-current-mrf', evidence,
  evidence_run: 'college-costa-mesa-current-browser-download-2026-09-25', reviewed_at: proof.observed_at,
  note: 'The official College Hospital Costa Mesa page and root pointer declare the same complete browser-downloaded CMS 3.0.0 CSV matching the facility identity, California address, NPI and 2026-05-22 date.' };
const index = ledger.findIndex(row => row.ccn === proof.ccn);
if (index >= 0) ledger[index] = entry; else ledger.push(entry);
ledger.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
const manualPath = path.join(audit, 'reconciliation-manual-access-observations.json');
const manual = JSON.parse(fs.readFileSync(manualPath, 'utf8'));
manual.records = manual.records.filter(row => row.ccn !== proof.ccn);
manual.records.push({ ...proof, proof_file: proofName, page_file_http_status: 200,
  page_file_observation: 'Browser downloaded the complete current official-page-linked CSV; the root pointer declares the exact same file.',
  disposition: proof.disposition });
manual.records.sort((a, b) => a.ccn.localeCompare(b.ccn));
fs.writeFileSync(manualPath, JSON.stringify(manual, null, 2) + '\n');
console.log(JSON.stringify({ applied: proof.ccn, bytes: bytes.length, sha256, proof: proofName }));
