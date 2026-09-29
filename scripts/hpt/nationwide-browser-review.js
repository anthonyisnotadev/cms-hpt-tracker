'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeUrl } = require('./pointer-corpus');

const ROOT = path.resolve(__dirname, '..', '..');
const FILE = path.join(ROOT, 'data', 'hpt-audit', 'nationwide-browser-reviews.json');
const ALLOWED_KINDS = new Set(['pointer', 'mrf']);
const ALLOWED_STATUSES = new Set([
  'retrieved', 'http-not-found', 'http-denied', 'http-error', 'challenge',
  'html-unusable', 'browser-client-blocked', 'navigation-failed'
]);
const ALLOWED_IDENTITIES = new Set(['', 'corroborated', 'unresolved', 'conflicting']);

function arg(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find(item => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : '';
}

function upsert(document, record) {
  const records = document.records || [];
  const index = records.findIndex(item => item.kind === record.kind && normalizeUrl(item.target) === normalizeUrl(record.target));
  if (index < 0) records.push(record);
  else {
    const prior = records[index];
    records[index] = { ...record, history: [...(prior.history || []), { ...prior, history: undefined }] };
  }
  records.sort((a, b) => a.kind.localeCompare(b.kind) || normalizeUrl(a.target).localeCompare(normalizeUrl(b.target)));
  return { schema_version: 1, updated_at: record.observed_at, records };
}

function main() {
  const kind = arg('kind');
  const target = arg('target');
  const status = arg('status');
  if (!ALLOWED_KINDS.has(kind)) throw new Error(`--kind must be one of: ${[...ALLOWED_KINDS].join(', ')}`);
  if (!normalizeUrl(target)) throw new Error('--target must be an HTTP(S) URL');
  if (!ALLOWED_STATUSES.has(status)) throw new Error(`--status must be one of: ${[...ALLOWED_STATUSES].join(', ')}`);
  const identity = arg('identity');
  if (!ALLOWED_IDENTITIES.has(identity)) throw new Error('--identity must be corroborated, unresolved, or conflicting');
  const record = {
    kind, target, final_url: arg('final-url') || target, status,
    title: arg('title'), detail: arg('detail'), browser: arg('browser') || 'codex-in-app-browser',
    http_status: arg('http-status'), bytes_read: arg('bytes-read'), content_range: arg('content-range'),
    identity, declared_hospital_name: arg('hospital-name'), declared_location_name: arg('location-name'),
    declared_address: arg('address'), declared_last_updated: arg('last-updated'),
    cms_template_version: arg('cms-version'),
    observed_at: new Date().toISOString()
  };
  const current = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { schema_version: 1, records: [] };
  const next = upsert(current, record);
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
}

if (require.main === module) main();
module.exports = { upsert, ALLOWED_KINDS, ALLOWED_STATUSES, ALLOWED_IDENTITIES };
