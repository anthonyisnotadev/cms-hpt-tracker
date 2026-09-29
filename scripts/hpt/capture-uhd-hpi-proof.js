'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'cms_data/hpt/nationwide-verification/file-byte-proof/uhd-241369-hpi-head.bin');
const url = 'https://sthpiprd.blob.core.windows.net/machine-readable-files/8132/454165628-1952307688_united-hospital-district%2C-inc_standardcharges.csv';
const req = https.get(url, { headers: { Range: 'bytes=0-262143' } }, res => {
  if (res.statusCode !== 206 && res.statusCode !== 200) throw new Error(`Unexpected HTTP ${res.statusCode}`);
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => {
    const bytes = Buffer.concat(chunks).subarray(0, 262144);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, bytes);
    console.log(JSON.stringify({ bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), out }, null, 2));
  });
});
req.on('error', err => { throw err; });
