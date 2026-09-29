'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const pointerUrl = 'https://frederickhealth.org/cms-hpt.txt';
const sourcePageUrl = 'https://www.frederickhealth.org/about/billing-financial-assistance/';
const pointerMrfUrl = 'https://www.frederickhealth.org/documents/billing%20and%20finance/52-0591612_FrederickHealthHospital_standardcharges.csv';
const currentMrfUrl = 'https://www.frederickhealth.org/documents/billing%20and%20finance/52-0591612_frederick_health_standardcharges%5B3%5D.csv';

function arg(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : '';
}

function sha(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const input = path.resolve(arg('input'));
  if (!fs.existsSync(input)) throw new Error('--input must name the browser-downloaded Frederick CSV');
  const file = fs.readFileSync(input);
  const sample = file.subarray(0, 262144);
  const text = sample.toString('utf8');
  if (!text.includes('Frederick Health Hospital,8/26/2026,3.0.0,Frederick Health Hospital,"400 W 7th St, Frederick, MD 21701"')) {
    throw new Error('Downloaded file does not reproduce the expected Frederick identity and metadata');
  }

  if (arg('source-url') !== sourcePageUrl || arg('source-file-url') !== currentMrfUrl) {
    throw new Error('Exact browser-observed Frederick source page and file URLs are required');
  }
  const pointer = fs.readFileSync(path.join(audit, 'pointers/frederickhealth.org.txt'));
  if (!pointer.toString('utf8').includes(pointerMrfUrl)) throw new Error('Saved Frederick pointer does not reproduce the standing MRF URL');

  const sampleDir = path.join(audit, 'file-byte-samples');
  fs.mkdirSync(sampleDir, { recursive: true });
  const sampleSha = sha(sample);
  const samplePath = path.join(sampleDir, `${sampleSha}.bin`);
  if (!fs.existsSync(samplePath)) fs.writeFileSync(samplePath, sample);
  const proofPath = path.join(audit, 'reconciliation-frederick-pointer-mismatch-proof.json');
  const priorProof = fs.existsSync(proofPath) ? JSON.parse(fs.readFileSync(proofPath, 'utf8')) : null;
  const proof = {
    ccn: '210005',
    disposition: 'official-source-page-newer-mrf-root-pointer-still-links-older-file',
    official_domain: 'frederickhealth.org',
    pointer_url: pointerUrl,
    pointer_transport: 'standing-retrieved-pointer-artifact',
    pointer_sha256: sha(pointer),
    pointer_mrf_url: pointerMrfUrl,
    source_page_url: sourcePageUrl,
    source_page_transport: 'browser-rendered-exact-link',
    current_mrf_url: currentMrfUrl,
    current_mrf_transport: 'browser-download-complete',
    current_mrf_http_status: 200,
    current_mrf_sha256: sha(file),
    retained_bytes: sample.length,
    retained_sample: path.relative(root, samplePath).replaceAll('\\', '/'),
    total_file_bytes: file.length,
    declared_hospital_name: 'Frederick Health Hospital',
    declared_location_name: 'Frederick Health Hospital',
    declared_address: '400 W 7th St, Frederick, MD 21701',
    declared_state: 'MD',
    declared_date: '2026-08-26',
    version: '3.0.0',
    observed_at: priorProof?.current_mrf_sha256 === sha(file) ? priorProof.observed_at : new Date().toISOString(),
    next_action: 'Retain the current official-page file and exact identity metadata, but keep the root-pointer mismatch explicit until cms-hpt.txt is updated.',
  };
  fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify(proof, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
