#!/usr/bin/env node
'use strict';
// Publication boundary: operates only on Git-visible public artifacts, never
// private input files or ignored retrieval caches. Run after report generation.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { loadKey, encryptValue, isObfuscated } = require('./hpt/lib/pointer-obfuscation');
const { protectContacts, contactCount } = require('./hpt/lib/public-contact-text');
const { csvToObjects, toCSV } = require('./hpt/lib/util');
const ROOT = path.resolve(__dirname, '..');
const CONTACT = /^(?:contact(?:[-_ ]?(?:name|email|phone|telephone|fax))?|(?:phone|telephone|fax)(?:[-_ ]?number)?|email)$/i;
function protectDocument(text, extension, key) {
  function walk(value, field, contact = false) {
    contact = contact || CONTACT.test(field || '');
    if (typeof value === 'number' && contact) return encryptValue(String(value), key);
    if (typeof value === 'string') {
      if (contact && value && !isObfuscated(value) && !/^\[.*\]$/.test(value)) return encryptValue(value, key);
      return protectContacts(value, key);
    }
    if (Array.isArray(value)) return value.map(v => walk(v, field, contact));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, walk(v,k,contact)]));
    return value;
  }
  if (extension === '.json') {
    const source = JSON.parse(text), result = walk(source);
    const indentation = text.match(/\n([ \t]+)\S/)?.[1] || '  ';
    return JSON.stringify(source) === JSON.stringify(result) ? text : JSON.stringify(result, null, indentation) + '\n';
  }
  if (extension === '.csv') {
    const rows = csvToObjects(text);
    const result = rows.map(row => walk(row));
    return JSON.stringify(rows) === JSON.stringify(result) ? text : toCSV(result, Object.keys(rows[0] || {}));
  }
  return protectContacts(text, key);
}
function run(check = false) {
  const key = loadKey(); // Fail closed if encryption is unavailable.
  const files = cp.execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 30e6 }).split('\0');
  let changed = 0, scanned = 0;
  for (const file of new Set(files)) {
    if (!/^(?:data\/|cms_data\/|[^/]+\.html$)/.test(file) || !/\.(?:json|csv|txt|html)$/.test(file)) continue;
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) continue;
    const before = fs.readFileSync(full, 'utf8');
    const after = protectDocument(before, path.extname(file), key);
    scanned++;
    if (after !== before) {
      changed++;
      if (check) console.error('Unprotected contact data: ' + file);
      else fs.writeFileSync(full, after);
    }
    if (contactCount(after)) throw new Error('Contact protection incomplete: ' + file);
  }
  console.log(JSON.stringify({ scanned, changed, mode: check ? 'check' : 'protect' }));
  if (check && changed) throw new Error('Run npm run protect:contacts before publishing');
}
if (require.main === module) run(process.argv.includes('--check'));
module.exports = { protectDocument, run };
