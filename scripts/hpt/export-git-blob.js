'use strict';

// Export one immutable Git object to a standalone file for reproducible
// rebuilds performed outside the checkout that owns the Git object database.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const [objectPath, destination] = process.argv.slice(2);
if (!objectPath || !destination || process.argv.length !== 4) {
  throw new Error('Usage: node scripts/hpt/export-git-blob.js <ref:path> <destination>');
}
const bytes = execFileSync('git', ['show', objectPath], {
  cwd: path.resolve(__dirname, '../..'),
  maxBuffer: 64 * 1024 * 1024,
});
const output = path.resolve(destination);
if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing file: ${output}`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, bytes, { flag: 'wx' });
console.log(`${objectPath} -> ${output} (${bytes.length} bytes)`);
