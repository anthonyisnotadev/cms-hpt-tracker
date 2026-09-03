'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const os = require('os');
const path = require('path');

const { loadKey, obfuscatePointerText } = require('../lib/pointer-obfuscation');
const { serveStatic } = require('../../static-files');

test('local static serving decrypts pointer contacts in memory and refuses the key file', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'hpt-static-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const pointerDir = path.join(root, 'data', 'hpt-audit', 'pointers');
  const keyFile = path.join(root, 'data', 'hpt-audit', '.pointer-obfuscation-key');
  await fsp.mkdir(pointerDir, { recursive: true });
  const key = loadKey({ keyFile, create: true });
  const source = 'location-name: Example\ncontact-name: Pat Example\ncontact-email: pat@example.test\n';
  const protectedDoc = obfuscatePointerText(source, key).text;
  await fsp.writeFile(path.join(pointerDir, 'example.txt'), protectedDoc);

  const server = http.createServer((req, res) => serveStatic(req, res, { root, keyFile }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  const pointer = await fetch(`http://127.0.0.1:${port}/data/hpt-audit/pointers/example.txt`);
  assert.equal(pointer.status, 200);
  assert.equal(await pointer.text(), source);
  assert.equal(await fsp.readFile(path.join(pointerDir, 'example.txt'), 'utf8'), protectedDoc);

  const keyResponse = await fetch(`http://127.0.0.1:${port}/data/hpt-audit/.pointer-obfuscation-key`);
  assert.equal(keyResponse.status, 403);
  assert.doesNotMatch(await keyResponse.text(), /[A-Za-z0-9_-]{43}/);
});
