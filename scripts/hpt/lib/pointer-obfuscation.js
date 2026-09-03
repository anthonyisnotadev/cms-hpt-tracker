'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const DEFAULT_KEY_FILE = path.join(ROOT, 'data', 'hpt-audit', '.pointer-obfuscation-key');
const PREFIX = 'hpt-obf:v1:';
const MARKER_SOURCE = 'hpt-obf:v1:([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]+)';
const FULL_MARKER = new RegExp(`^${MARKER_SOURCE}$`);
const CONTACT_KEY = /^(?:contact|contact[-_ ]?name|contact[-_ ]?email)$/i;
const TEXT_CONTACT_LINE = /^(\s*(?:contact|contact[-_ ]?name|contact[-_ ]?email)\s*:\s*)(.*?)(\r?)$/gmi;

function decodeKey(raw) {
  const key = Buffer.from(String(raw || '').trim(), 'base64url');
  if (key.length !== 32) throw new Error('pointer obfuscation key must decode to exactly 32 bytes');
  return key;
}

function loadKey({ keyFile = DEFAULT_KEY_FILE, create = false } = {}) {
  try {
    return decodeKey(fs.readFileSync(keyFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
  }

  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  const encoded = crypto.randomBytes(32).toString('base64url');
  try {
    const fd = fs.openSync(keyFile, 'wx', 0o600);
    try { fs.writeFileSync(fd, `${encoded}\n`); } finally { fs.closeSync(fd); }
    return decodeKey(encoded);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return decodeKey(fs.readFileSync(keyFile, 'utf8'));
  }
}

function isObfuscated(value) {
  return FULL_MARKER.test(String(value || ''));
}

function encryptValue(value, key) {
  const plain = String(value);
  if (!plain || isObfuscated(plain)) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptValue(value, key) {
  const text = String(value || '');
  const match = text.match(FULL_MARKER);
  if (!match) return text;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(match[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(match[2], 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(match[3], 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch (_error) {
    throw new Error('could not decrypt pointer contact value; the key is missing or incorrect');
  }
}

function mapStrings(value, transform, stats) {
  if (typeof value === 'string') {
    if (!value) return value;
    stats.fields++;
    const mapped = transform(value);
    if (mapped !== value) stats.changed++;
    return mapped;
  }
  if (Array.isArray(value)) return value.map(item => mapStrings(item, transform, stats));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, transform, stats)]));
  }
  return value;
}

function transformJsonContacts(value, transform, stats) {
  if (Array.isArray(value)) return value.map(item => transformJsonContacts(item, transform, stats));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = CONTACT_KEY.test(key)
      ? mapStrings(item, transform, stats)
      : transformJsonContacts(item, transform, stats);
  }
  return out;
}

function jsonDocument(text) {
  const withoutBom = String(text).replace(/^\uFEFF/, '');
  if (!/^\s*[\[{]/.test(withoutBom)) return null;
  try { return { value: JSON.parse(withoutBom), hadNewline: /\r?\n$/.test(withoutBom) }; }
  catch (_error) { return null; }
}

function transformPointerText(text, transform) {
  const source = String(text);
  const json = jsonDocument(source);
  const stats = { fields: 0, changed: 0, format: json ? 'json' : 'txt' };
  if (json) {
    const mapped = transformJsonContacts(json.value, transform, stats);
    return { text: `${JSON.stringify(mapped, null, 2)}${json.hadNewline ? '\n' : ''}`, ...stats };
  }
  const mapped = source.replace(TEXT_CONTACT_LINE, (line, prefix, value, cr) => {
    if (!value) return line;
    stats.fields++;
    const next = transform(value);
    if (next !== value) stats.changed++;
    return `${prefix}${next}${cr}`;
  });
  return { text: mapped, ...stats };
}

function obfuscatePointerText(text, key) {
  return transformPointerText(text, value => encryptValue(value, key));
}

function deobfuscatePointerText(text, key) {
  return transformPointerText(text, value => decryptValue(value, key));
}

function inspectPointerText(text) {
  const source = String(text);
  const json = jsonDocument(source);
  const stats = { fields: 0, protected: 0, plaintext: 0, format: json ? 'json' : 'txt' };
  const inspect = value => {
    if (typeof value === 'string') {
      if (!value) return;
      stats.fields++;
      if (isObfuscated(value)) stats.protected++;
      else stats.plaintext++;
    } else if (Array.isArray(value)) value.forEach(inspect);
    else if (value && typeof value === 'object') Object.values(value).forEach(inspect);
  };
  if (json) {
    const visit = value => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (CONTACT_KEY.test(key)) inspect(item);
        else visit(item);
      }
    };
    visit(json.value);
    return stats;
  }
  source.replace(TEXT_CONTACT_LINE, (line, _prefix, value) => { inspect(value); return line; });
  return stats;
}

function protectPointerTextIfEnabled(text, { keyFile = DEFAULT_KEY_FILE } = {}) {
  if (!fs.existsSync(keyFile)) return String(text);
  return obfuscatePointerText(text, loadKey({ keyFile })).text;
}

module.exports = {
  DEFAULT_KEY_FILE,
  PREFIX,
  loadKey,
  isObfuscated,
  encryptValue,
  decryptValue,
  obfuscatePointerText,
  deobfuscatePointerText,
  inspectPointerText,
  protectPointerTextIfEnabled
};
