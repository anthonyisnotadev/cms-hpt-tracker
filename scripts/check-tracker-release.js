#!/usr/bin/env node
'use strict';

// CI verifies the locally reviewed build without publishing its ignored raw
// proof samples. Regenerate this manifest only after a successful local build.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const MANIFEST = 'data/hpt-audit/tracker-release-manifest.json';
const OUTPUTS = ['tracker.html', 'index.html', 'mrf.html', 'rules.html', 'pointer.html', 'skill.html'];
const digest = bytes => crypto.createHash('sha256').update(String(bytes).replace(/\r\n/g, '\n')).digest('hex');

function inputFiles() {
  return [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 100e6 }).split('\0'))]
    .filter(file => file && file !== MANIFEST && (
      /^(?:scripts\/.*\.js|css\/.*\.css|js\/.*\.js)$/.test(file)
      || /^(?:data\/hpt-audit\/|cms_data\/).*\.(?:json|csv|md|txt)$/.test(file)
      || ['package.json', 'package-lock.json', '.gitignore', '.github/workflows/pages.yml',
        'data/hpt-audit/.pointer-obfuscation-key'].includes(file)))
    .sort();
}

function validateSnapshot(data) {
  if (data.rows?.length !== 5419 || new Set(data.rows.map(row => row[0])).size !== 5419)
    throw new Error('Tracker must contain exactly 5,419 unique CCNs');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.generated || '')) throw new Error('Missing snapshot date');
  if (!Array.isArray(data.queue) || data.queue.some(row => !Number.isInteger(row.n) || row.n <= 0))
    throw new Error('Invalid reviewed work queue');
}

function run(write = false) {
  const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
  const match = read('tracker.html').match(/<script id="tracker-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Missing tracker data');
  const data = JSON.parse(match[1]);
  validateSnapshot(data);
  const hashes = files => Object.fromEntries(files.map(file => [file, digest(read(file))]));
  const current = { version: 1, snapshot: data.generated, hospitals: data.rows.length,
    inputs: hashes(inputFiles()), outputs: hashes(OUTPUTS) };
  if (write) fs.writeFileSync(path.join(ROOT, MANIFEST), JSON.stringify(current, null, 2) + '\n');
  else {
    const expected = JSON.parse(read(MANIFEST));
    if (JSON.stringify(current) !== JSON.stringify(expected))
      throw new Error('Committed tracker release is stale: rebuild locally with retained proof bytes, then regenerate the release manifest');
  }
  console.log(`${write ? 'Recorded' : 'Verified'} ${Object.keys(current.inputs).length} release inputs and ${OUTPUTS.length} pages; ${data.rows.length} hospitals, snapshot ${data.generated}`);
}
if (require.main === module) run(process.argv.includes('--write'));
module.exports = { digest, validateSnapshot };
