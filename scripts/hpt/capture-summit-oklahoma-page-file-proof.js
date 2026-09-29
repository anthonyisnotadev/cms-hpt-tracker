'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof/summit-oklahoma-370225-head.bin');
const url = 'https://scfx-estimator.azurewebsites.net/Download/Mrf';
https.get(url, res => {
  if (res.statusCode !== 200) throw new Error(`Unexpected HTTP ${res.statusCode}`);
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => {
    const bytes = Buffer.concat(chunks).subarray(0, 262144);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, bytes);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    console.log(JSON.stringify({ bytes: bytes.length, sha256, out }, null, 2));
  });
}).on('error', err => { throw err; });
