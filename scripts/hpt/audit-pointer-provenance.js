'use strict';

// Audit the pointer bytes attributed to every nationwide row against the
// retained corpus index. This is a provenance check, never an MRF promotion.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');

const root = path.resolve(__dirname, '../..');
const verificationFile = path.join(root, 'data/hpt-audit/nationwide-verification.json');
const corpusFile = path.join(root, 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv');
const outputFile = path.join(root, 'data/hpt-audit/pointer-provenance-discrepancies.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function build(verification, corpus) {
  const byRequestedUrl = new Map();
  for (const row of corpus) {
    if (!row.pointer_url || !row.pointer_sha256) continue;
    if (!byRequestedUrl.has(row.pointer_url)) byRequestedUrl.set(row.pointer_url, new Map());
    const versions = byRequestedUrl.get(row.pointer_url);
    const previous = versions.get(row.pointer_sha256);
    if (!previous || String(row.fetched_at) > String(previous.fetched_at))
      versions.set(row.pointer_sha256, { sha256: row.pointer_sha256, fetched_at: row.fetched_at,
        raw_file: String(row.raw_file || '').replace(/\\/g, '/') });
  }
  const comparable = verification.records.filter(row => row.pointer_corpus_checked_url && row.pointer_corpus_sha256);
  const unmatched = [], unindexed = [];
  for (const row of comparable) {
    const versions = byRequestedUrl.get(row.pointer_corpus_checked_url);
    const common = { ccn: row.ccn, hospital_name: row.hospital_name,
      checked_url: row.pointer_corpus_checked_url,
      verification_sha256: row.pointer_corpus_sha256,
      verification_observed_at: row.pointer_corpus_observed_at,
      disposition: row.disposition };
    if (!versions) {
      unindexed.push({ ...common, issue: 'no-corpus-index-entry-for-exact-requested-url' });
      continue;
    }
    if (versions.has(row.pointer_corpus_sha256)) continue;
    unmatched.push({ ...common, issue: 'verification-hash-not-in-corpus-index-for-exact-requested-url',
      corpus_versions: [...versions.values()].sort((a, b) => a.fetched_at.localeCompare(b.fetched_at)) });
  }
  unmatched.sort((a, b) => a.ccn.localeCompare(b.ccn));
  unindexed.sort((a, b) => a.ccn.localeCompare(b.ccn));
  const historical = verification.records.filter(row => row.pointer_historical_checked_url && row.pointer_historical_sha256)
    .map(row => {
      const versions = byRequestedUrl.get(row.pointer_historical_checked_url);
      return { ccn: row.ccn, hospital_name: row.hospital_name,
        checked_url: row.pointer_historical_checked_url,
        historical_sha256: row.pointer_historical_sha256,
        historical_observed_at: row.pointer_historical_observed_at,
        retained_raw_status: row.pointer_historical_raw_integrity,
        later_pointer_state: row.pointer_state,
        index_status: !versions ? 'not-indexed-after-failed-retry'
          : versions.has(row.pointer_historical_sha256) ? 'hash-correlated' : 'hash-unmatched' };
    }).sort((a, b) => a.ccn.localeCompare(b.ccn));
  return { summary: { hospitals: verification.records.length, pointer_provenance_rows: comparable.length,
    exact_url_hash_correlated: comparable.length - unmatched.length - unindexed.length,
    hash_unmatched_for_exact_url: unmatched.length, no_exact_url_corpus_entry: unindexed.length,
    historical_pointer_rows: historical.length,
    historical_not_indexed: historical.filter(row => row.index_status === 'not-indexed-after-failed-retry').length,
    historical_hash_correlated: historical.filter(row => row.index_status === 'hash-correlated').length,
    historical_hash_unmatched: historical.filter(row => row.index_status === 'hash-unmatched').length },
    unmatched, unindexed, historical };
}

function main() {
  const verificationBytes = fs.readFileSync(verificationFile);
  const corpusBytes = fs.readFileSync(corpusFile);
  const result = build(JSON.parse(verificationBytes), csvToObjects(corpusBytes.toString('utf8')));
  for (const discrepancy of result.unmatched) for (const version of discrepancy.corpus_versions) {
    const raw = path.resolve(root, version.raw_file || '');
    if (!version.raw_file || !raw.startsWith(root + path.sep) || !fs.existsSync(raw)) {
      version.retained_raw_status = 'missing-or-outside-workspace';
      continue;
    }
    version.retained_raw_sha256 = sha(fs.readFileSync(raw));
    version.retained_raw_status = version.retained_raw_sha256 === version.sha256
      ? 'hash-corroborated' : 'hash-conflict';
  }
  result.source_sha256 = {
    'nationwide-verification.json': sha(verificationBytes),
    'cms_hpt_entries.csv': sha(corpusBytes),
  };
  fs.writeFileSync(outputFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result.summary));
}

if (require.main === module) main();
module.exports = { build };
