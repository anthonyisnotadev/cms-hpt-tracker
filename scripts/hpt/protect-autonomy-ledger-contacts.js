#!/usr/bin/env node
'use strict';

// The public contact protector handles JSON, CSV, TXT, HTML, and Markdown.
// Audit ledgers use JSONL, so protect them explicitly before publication.
const fs = require('node:fs');
const path = require('node:path');
const { loadKey } = require('./lib/pointer-obfuscation');
const { protectContacts, contactCount } = require('./lib/public-contact-text');

const dir = path.resolve(__dirname, '../../data/hpt-audit/autonomy');
const check = process.argv.includes('--check');
const key = loadKey();
let scanned = 0;
let changed = 0;

for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.jsonl')).sort()) {
  const file = path.join(dir, name);
  const original = fs.readFileSync(file, 'utf8');
  const protectedText = protectContacts(original, key);
  if (contactCount(protectedText)) throw new Error(`Contact protection incomplete: ${name}`);
  for (const line of protectedText.split(/\r?\n/).filter(Boolean)) JSON.parse(line);
  scanned++;
  if (protectedText !== original) {
    changed++;
    if (check) console.error(`Unprotected contact data: ${name}`);
    else fs.writeFileSync(file, protectedText);
  }
}

console.log(JSON.stringify({ scanned, changed, mode: check ? 'check' : 'protect' }));
if (check && changed) process.exitCode = 1;
