#!/usr/bin/env node
'use strict';

/**
 * Obfuscate contact-name and contact-email values in data/hpt-audit/pointers/*.txt.
 *
 *   node scripts/hpt/obfuscate-pointers.js
 *   node scripts/hpt/obfuscate-pointers.js --check
 *   node scripts/hpt/obfuscate-pointers.js --restore
 *
 * The AES-256-GCM key is generated locally, tracked for shared decoding, and
 * never printed by this command. This is obfuscation rather than secret storage.
 * Obfuscation is atomic and idempotent. The local servers decrypt protected
 * pointer responses in memory without writing plaintext back to disk.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  DEFAULT_KEY_FILE,
  loadKey,
  obfuscatePointerText,
  deobfuscatePointerText,
  inspectPointerText
} = require('./lib/pointer-obfuscation');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_DIR = path.join(ROOT, 'data', 'hpt-audit', 'pointers');
const DEFAULT_REPORT = path.join(ROOT, 'data', 'hpt-audit', 'pointer-obfuscation.json');

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) options[match[1]] = match[2] === undefined ? true : match[2];
  }
  return options;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeAtomic(file, contents) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, contents);
  fs.renameSync(temp, file);
}

function run(rawOptions = {}) {
  const options = typeof rawOptions === 'object' ? rawOptions : {};
  const pointerDir = path.resolve(options.dir || DEFAULT_DIR);
  const keyFile = path.resolve(options.key || DEFAULT_KEY_FILE);
  const reportFile = path.resolve(options.report || DEFAULT_REPORT);
  const mode = options.restore ? 'restore' : (options.check ? 'check' : 'obfuscate');
  const key = loadKey({ keyFile, create: mode === 'obfuscate' });
  const files = fs.readdirSync(pointerDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.txt'))
    .map(entry => path.join(pointerDir, entry.name))
    .sort((a, b) => a.localeCompare(b));

  const summary = {
    schemaVersion: 1,
    algorithm: 'AES-256-GCM',
    mode,
    files: files.length,
    filesChanged: 0,
    contactFields: 0,
    protectedFields: 0,
    plaintextFields: 0,
    entries: []
  };

  for (const file of files) {
    const current = fs.readFileSync(file, 'utf8');
    const plain = deobfuscatePointerText(current, key).text;
    const protectedDoc = obfuscatePointerText(current, key).text;
    const recovered = deobfuscatePointerText(protectedDoc, key).text;
    if (recovered !== plain) throw new Error(`round-trip verification failed for ${file}`);

    const target = mode === 'restore' ? plain : protectedDoc;
    const inspection = inspectPointerText(mode === 'restore' ? plain : protectedDoc);
    summary.contactFields += inspection.fields;
    summary.protectedFields += inspection.protected;
    summary.plaintextFields += inspection.plaintext;
    if (target !== current) {
      if (mode !== 'check') writeAtomic(file, target);
      summary.filesChanged++;
    }
    summary.entries.push({
      file: path.relative(ROOT, file),
      contactFields: inspection.fields,
      plaintextSha256: sha256(plain),
      storedSha256: sha256(target)
    });
  }

  if (mode === 'check') {
    if (summary.plaintextFields || summary.filesChanged) {
      throw new Error(`${summary.plaintextFields} plaintext contact fields remain in ${summary.filesChanged} files`);
    }
  } else if (mode === 'obfuscate') {
    writeAtomic(reportFile, `${JSON.stringify(summary, null, 1)}\n`);
  }
  return summary;
}

if (require.main === module) {
  try {
    const summary = run(parseArgs(process.argv.slice(2)));
    console.log(`${summary.mode}: ${summary.files} files, ${summary.contactFields} contact values, ${summary.filesChanged} files changed`);
    if (summary.mode !== 'restore') {
      console.log(`protected=${summary.protectedFields} plaintext=${summary.plaintextFields}`);
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { parseArgs, run };
