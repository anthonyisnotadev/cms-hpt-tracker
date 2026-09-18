'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeUrl } = require('./pointer-corpus');

const ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(ROOT, 'data', 'hpt-audit');
const FILE = path.join(AUDIT, 'nationwide-search-reviews.json');
const allowed = new Set(['official', 'candidate', 'completed-no-official', 'search-error']);

function args(argv) {
  const out = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

function validate(record) {
  if (!/^\d{6}$/.test(record.ccn)) throw Error('A six-character CCN is required');
  if (!allowed.has(record.status)) throw Error(`Unknown search status: ${record.status}`);
  if (!record.reason || !record.query) throw Error('Search query and adjudication reason are required');
  if (record.status === 'official') {
    if (!record.domain || !normalizeUrl(record.name_evidence) || !normalizeUrl(record.address_evidence))
      throw Error('Official website review requires domain, name evidence, and address evidence');
  }
  if (record.status === 'candidate' && !normalizeUrl(record.candidate_url)) throw Error('Candidate review requires a candidate URL');
  return record;
}

function upsert(document, record) {
  const records = document.records || [];
  const prior = records.find(item => item.ccn === record.ccn);
  if (prior) {
    prior.history = [...(prior.history || []), { ...prior }].map(({ history, ...item }) => item);
    Object.assign(prior, record);
  } else records.push(record);
  records.sort((a, b) => a.ccn.localeCompare(b.ccn));
  return { schema_version: 1, updated_at: record.observed_at, records };
}

function main() {
  const options = args(process.argv.slice(2));
  const inventory = JSON.parse(fs.readFileSync(path.join(AUDIT, 'nationwide-verification.json'), 'utf8')).records;
  const hospital = inventory.find(row => row.ccn === options.ccn);
  if (!hospital) throw Error(`CCN ${options.ccn || '(missing)'} is not in the nationwide inventory`);
  const record = validate({
    ccn: options.ccn, hospital_name: hospital.hospital_name, city: hospital.city, state: hospital.state,
    status: options.status, domain: options.domain || '', candidate_url: options['candidate-url'] || '',
    name_evidence: options['name-evidence'] || '', address_evidence: options['address-evidence'] || '',
    query: options.query, reason: options.reason, search_source: options.source || 'built-in-web-search',
    observed_at: options['observed-at'] || new Date().toISOString()
  });
  const document = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { schema_version: 1, records: [] };
  fs.writeFileSync(FILE, JSON.stringify(upsert(document, record), null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
}

if (require.main === module) main();
module.exports = { validate, upsert };
