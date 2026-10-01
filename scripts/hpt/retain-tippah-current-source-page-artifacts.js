'use strict';

// Retain source-page and pointer bytes separately from the already captured
// complete MRF so the source hashes in its proof can be independently checked.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { retrieve, sha } = require('./lib/recovery-transport');

const ROOT = path.resolve(__dirname, '../..');
const AUDIT = path.join(ROOT, 'data/hpt-audit');
const RAW = path.join(ROOT, 'cms_data/hpt/nationwide-verification/file-byte-proof');
const POINTER_RAW = path.join(ROOT, 'cms_data/hpt/pointer-corpus/raw/tippahcountyhospital.com-a5d65b45643d.txt');
const proofPath = path.join(AUDIT, 'reconciliation-tippah-current-pointer-file-proof-2026-09-30.json');
const sources = [
  { key: 'official_site', url: 'https://www.tippahcountyhospital.com/', cap: 262144 },
  { key: 'source_page', url: 'https://secure.claraprice.net/price-transparency/tippah-county-hospital-ms', cap: 262144 },
  { key: 'pointer', url: 'https://tippahcountyhospital.com/cms-hpt.txt', cap: 32768 }
];

function assert(condition, message) { if (!condition) throw new Error(message); }
async function retain(key, url, body) {
  const digest = sha(body);
  const ext = key === 'pointer' ? 'txt' : 'html';
  const output = path.join(RAW, `${digest}.${ext}`);
  if (fs.existsSync(output)) {
    const prior = fs.readFileSync(output);
    assert(prior.length === body.length && sha(prior) === digest, `${key} retained artifact mismatch`);
  } else await fsp.writeFile(output, body, { flag: 'wx' });
  return { status_file: path.relative(ROOT, output).replace(/\\/g, '/'), bytes: body.length, sha256: digest, url };
}

async function main() {
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  const captures = {};
  for (const source of sources) {
    const response = await retrieve(source.url, source.cap, { timeoutMs: 20000 });
    assert(response.status >= 200 && response.status < 300, `${source.key} HTTP ${response.status}`);
    captures[source.key] = await retain(source.key, source.url, response.body);
    captures[source.key].status = response.status;
    captures[source.key].complete = source.key === 'pointer'
      ? Number(response.headers['content-length'] || response.body.length) === response.body.length
      : Boolean(response.headers['content-length']) && Number(response.headers['content-length']) === response.body.length;
  }
  assert(captures.pointer.sha256 === proof.pointer_sha256, 'Current root pointer differs from the MRF capture');
  assert(fs.readFileSync(path.join(ROOT, captures.official_site.status_file), 'utf8').includes(proof.official_site_linked_pricing_page), 'Current first-party page sample does not contain the observed Price Transparency link');
  assert(fs.existsSync(POINTER_RAW) && sha(fs.readFileSync(POINTER_RAW)) === proof.pointer_sha256, 'Existing corpus raw pointer does not reproduce its hash');
  proof.source_capture_at = new Date().toISOString();
  proof.official_site_sha256 = captures.official_site.sha256;
  proof.official_site_status = captures.official_site.status;
  proof.retained_official_site = captures.official_site.status_file;
  proof.retained_official_site_bytes = captures.official_site.bytes;
  proof.official_site_complete_capture = captures.official_site.complete;
  proof.source_page_sha256 = captures.source_page.sha256;
  proof.source_page_status = captures.source_page.status;
  proof.retained_source_page = captures.source_page.status_file;
  proof.retained_source_page_bytes = captures.source_page.bytes;
  proof.source_page_complete_capture = captures.source_page.complete;
  proof.retained_pointer = path.relative(ROOT, POINTER_RAW).replace(/\\/g, '/');
  proof.retained_pointer_bytes = fs.statSync(POINTER_RAW).size;
  const temp = `${proofPath}.partial`;
  await fsp.writeFile(temp, JSON.stringify(proof, null, 2) + '\n');
  await fsp.rename(temp, proofPath);
  console.log(JSON.stringify({ source_capture_at: proof.source_capture_at, retained: captures, pointer_corpus_raw: proof.retained_pointer }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
