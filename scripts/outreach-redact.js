#!/usr/bin/env node
/* Generates cms_data/outreach.public.json from cms_data/outreach.json.
 *
 * The private file never leaves this machine. This script derives a shareable
 * copy from it: every email address has its local part masked (jdoe@examplehospital.org
 * -> j***@examplehospital.org), and the person names in NAME_SUBS are replaced so
 * individual hospital staff can't be identified in the public record. The
 * hospital domain stays visible — it is public information and useful context.
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

/* Person names that appear in notes/emails. Extend as new contacts are logged.
 * Keys must be lowercase for matching; values are the public replacement. */
const NAME_SUBS = {
  'jane doe': 'the hospital contact',
  'john smith': 'the hospital contact',
  'sam lee': 'the hospital contact',
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function maskEmail(addr) {
  const at = addr.indexOf('@');
  if (at <= 0) return addr;
  const local = addr.slice(0, at);
  const domain = addr.slice(at);
  return local[0] + '***' + domain;
}

function maskNames(s) {
  let out = s;
  Object.keys(NAME_SUBS).forEach((name) => {
    out = out.replace(new RegExp(name, 'gi'), NAME_SUBS[name]);
  });
  return out;
}

/* "Contact: the hospital pricing team (d***@peacehealth.org)" still reads fine;
 * "Emailed d***@norcen.org (bounced ...)" too. Applied to every string field. */
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
  fs.writeFileSync(tmp, `${JSON.stringify(redacted, null, 2)}\n`);
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
      console.error(`no private file at ${path.relative(ROOT, SRC)} — nothing to redact`);
      process.exit(1);
    }
    throw e;
  }
}
