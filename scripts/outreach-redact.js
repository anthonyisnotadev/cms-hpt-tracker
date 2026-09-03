#!/usr/bin/env node
/* Generates cms_data/outreach.public.json from cms_data/outreach.json.
 *
 * The private file never leaves this machine. This script derives a shareable
 * copy from it: every email address has its local part masked
 * (jdoe@examplehospital.org -> j***@examplehospital.org), and the person names
 * listed in cms_data/redact-names.json (private, gitignored) are replaced so
 * individual hospital staff can't be identified in the public record. The
 * hospital domain stays visible - it is public information and useful context.
 *
 * Run by hand (npm run redact) or automatically after every store save.
 *
 * No dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'cms_data', 'outreach.json');
const DST = path.join(ROOT, 'cms_data', 'outreach.public.json');
const NAMES_FILE = path.join(ROOT, 'cms_data', 'redact-names.json');

/* Person names that appear in notes/emails, as a private
 * cms_data/redact-names.json map: { "real name": "public replacement" }.
 * Keys must be lowercase for matching. The file is gitignored - publishing
 * the keys would defeat the masking. See redact-names.example.json. */
function loadNameSubs() {
  try {
    return JSON.parse(fs.readFileSync(NAMES_FILE, 'utf8'));
  } catch (e) {
    return {}; /* no list configured - emails still masked, names pass through */
  }
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function maskEmail(addr) {
  const at = addr.indexOf('@');
  if (at <= 0) return addr;
  const local = addr.slice(0, at);
  const domain = addr.slice(at);
  return local[0] + '***' + domain;
}

function maskNames(s) {
  const subs = loadNameSubs();
  let out = s;
  Object.keys(subs).forEach((name) => {
    out = out.replace(new RegExp(name, 'gi'), subs[name]);
  });
  return out;
}

/* Applied to every string field: names first, then any surviving address. */
function redactString(s) {
  return maskNames(s).replace(EMAIL_RE, maskEmail);
}

function redactValue(v) {
  if (typeof v === 'string') return redactString(v);
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).forEach((k) => { out[k] = redactValue(v[k]); });
    return out;
  }
  return v;
}

function generate(src, dst) {
  const data = JSON.parse(fs.readFileSync(src, 'utf8'));
  const redacted = redactValue(data);
  const tmp = `${dst}.${process.pid}.tmp`;
  const publicJson = JSON.stringify(redacted, null, 2).replace(/\u2014/g, '-');
  fs.writeFileSync(tmp, `${publicJson}\n`);
  fs.renameSync(tmp, dst);
  return dst;
}

module.exports = { generate, redactString, maskEmail, SRC, DST };

if (require.main === module) {
  try {
    generate(SRC, DST);
    console.log(`wrote ${path.relative(ROOT, DST)}`);
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.error(`no private file at ${path.relative(ROOT, SRC)} - nothing to redact`);
      process.exit(1);
    }
    throw e;
  }
}
