'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { retrieve, parsePayload, sha, safeUrl } = require('./lib/recovery-transport');
const { retainedRootMatches } = require('./audit-nationwide-source-proof');
const root = path.resolve(__dirname, '../..');
const url = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/7906/274658935_martin-luther-king%2C-jr-los-angeles-mlkla-healthcare-corporation_standardcharges.csv';
const ccn = '050779';

async function main() {
  const response = await retrieve(url, 262144, { timeoutMs: 90000 });
  if (!(response.status >= 200 && response.status < 300) || !response.body.length) throw new Error(`MLK retrieval failed: ${response.status} ${response.body.length}`);
  const parsed = await parsePayload(response.body, 'text/csv');
  const nationwide = JSON.parse(fs.readFileSync(path.join(root, 'data/hpt-audit/nationwide-verification.json'), 'utf8')).records;
  const claim = nationwide.find(row => row.ccn === ccn);
  const candidate = (parsed.parsed || []).find(row => retainedRootMatches(claim, row));
  if (!candidate) throw new Error('MLK sample does not reproduce the active claim');
  const digest = sha(response.body);
  const relative = `cms_data/hpt/nationwide-verification/file-byte-proof/${digest}.bin`;
  const artifact = path.join(root, relative);
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  if (!fs.existsSync(artifact)) fs.writeFileSync(artifact, response.body);
  const manifestPath = path.join(root, 'data/hpt-audit/nationwide-file-byte-proof.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const record = { url: safeUrl(url), ccns: [ccn], checked_at: '2026-09-26T06:30:00Z', final_url: response.finalUrl || url, final_host: new URL(response.finalUrl || url).host, url_sha256: sha(Buffer.from(safeUrl(url))), requested_host: new URL(url).host, http_status: response.status, requested_range: `bytes=0-${response.body.length - 1}`, bytes_retained: response.body.length, sha256: digest, raw_artifact: relative, content_type: 'text/csv', parsed_root_candidates: [candidate], error: '' };
  manifest.records = manifest.records.filter(row => !(row.ccns || []).includes(ccn));
  manifest.records.push(record);
  manifest.records.sort((a, b) => String(a.url).localeCompare(String(b.url)));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ccn, status: response.status, bytes: response.body.length, sha256: digest, candidate, artifact: relative }, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
