'use strict';
const fs = require('fs');
const path = require('path');
const { retrieve, sha } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const url = 'https://s3.amazonaws.com/ycubaa-production-marlin-1-charge-management-public/facilities/1b76b953-2b0b-45ad-849c-3b844c4b4c1d/720396868_CLAIBORNE-MEMORIAL-MEDICAL-CENTER_standardcharges.csv';
const outputDir = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof');

async function main() {
  const response = await retrieve(url, 2097152, { timeoutMs: 30000, curlOnStatuses: [403, 429, 500, 502, 503, 504] });
  if (response.status < 200 || response.status >= 300) throw new Error(`Unexpected HTTP ${response.status}`);
  const total = Number(String(response.headers['content-range'] || '').match(/\/(\d+)$/)?.[1] || response.body.length);
  if (response.body.length !== total || response.body.length > 2097152) throw new Error(`Incomplete workbook ${response.body.length}/${total}`);
  if (response.body.subarray(0, 2).toString('hex') !== '504b') throw new Error('Expected an Office ZIP container');
  fs.mkdirSync(outputDir, { recursive: true });
  const digest = sha(response.body);
  const artifact = path.join(outputDir, `${digest}.xlsx`);
  fs.writeFileSync(artifact, response.body);
  console.log(JSON.stringify({ ccn: '190114', url, http_status: response.status, bytes: response.body.length,
    sha256: digest, artifact: path.relative(root, artifact).replaceAll('\\', '/'), checked_at: response.checkedAt }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
