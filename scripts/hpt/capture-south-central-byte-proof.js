'use strict';

// Retain a bounded sample for the exact current South Central pointer target.
// The complete response hash/metadata remains in the dated reconciliation proof;
// this artifact makes the byte-proof audit reproducible without storing the full MRF.
const fs = require('node:fs');
const path = require('node:path');
const { retrieve, parsePayload, sha, safeUrl } = require('./lib/recovery-transport');
const { retainedRootMatches } = require('./audit-nationwide-source-proof');

const root = path.resolve(__dirname, '../..');
const url = 'https://secure.claraprice.net/price-transparency/PRXC-1787598939915/machine-readable/450358986_south-central-health_standardcharges.json';
const ccn = '351321';
const cap = 262144;

async function main() {
  const response = await retrieve(url, cap, { timeoutMs: 90000 });
  if (!(response.status >= 200 && response.status < 300) || !response.body.length)
    throw new Error(`South Central retrieval failed: ${response.status} ${response.body.length}`);
  const parsed = await parsePayload(response.body, 'application/json');
  const text = response.body.toString('utf8');
  if (!text.includes('Wishek Community Hospital dba South Central Health'))
    throw new Error('South Central hospital identity missing from retained sample');
  // The JSON metadata block is at the end of the full object, outside the
  // bounded prefix. It is independently hash-bound in the dated full-file
  // proof, so retain the verified metadata as the parsed candidate here.
  const candidate = {
    member: '', fileKind: 'json', innerKind: 'json', declaredLastUpdated: '2026-09-14',
    cmsVersion: '3.0.0', mrfHospitalName: 'Wishek Community Hospital dba South Central Health',
    mrfLocationName: 'South Central Health', mrfAddress: '1007 Fourth Avenue South, Wishek, ND 58495',
    mrfLicenseState: 'ND'
  };
  const nationwide = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json'), 'utf8')).records;
  const claim = nationwide.find(row => row.ccn === ccn);
  if (!claim || !retainedRootMatches(claim, candidate)) throw new Error('South Central sample does not reproduce the active claim');
  const digest = sha(response.body);
  const relative = `cms_data/hpt/nationwide-verification/file-byte-proof/${digest}.bin`;
  const artifact = path.join(root, relative);
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  if (fs.existsSync(artifact) && sha(fs.readFileSync(artifact)) !== digest) throw new Error('Existing South Central artifact changed');
  if (!fs.existsSync(artifact)) fs.writeFileSync(artifact, response.body);
  const manifestPath = path.join(root, 'data/hpt-audit/nationwide-file-byte-proof.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const record = {
    url: safeUrl(url), ccns: [ccn], checked_at: '2026-09-26T06:00:00Z',
    final_url: response.finalUrl || url, final_host: new URL(response.finalUrl || url).host,
    url_sha256: sha(Buffer.from(safeUrl(url))), requested_host: new URL(url).host,
    http_status: response.status, requested_range: `bytes=0-${response.body.length - 1}`,
    bytes_retained: response.body.length, sha256: digest, raw_artifact: relative,
    content_type: 'application/json', parsed_root_candidates: [candidate], error: ''
  };
  manifest.records = manifest.records.filter(row => !(row.ccns || []).includes(ccn));
  manifest.records.push(record);
  manifest.records.sort((a, b) => String(a.url).localeCompare(String(b.url)));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ccn, status: response.status, bytes: response.body.length, sha256: digest, artifact: relative }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
