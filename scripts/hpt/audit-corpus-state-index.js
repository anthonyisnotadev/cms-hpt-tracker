'use strict';

// Identify corpus CSV documents that are not backed by a successful target
// in the final crawl state. This is a provenance queue, not a facility finding.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { csvToObjects } = require('./lib/util');
const { normalizeUrl } = require('./pointer-corpus');

const root = path.resolve(__dirname, '../..');
const stateFile = path.join(root, 'cms_data/hpt/pointer-corpus/crawl-state.json');
const indexFile = path.join(root, 'cms_data/hpt/pointer-corpus/cms_hpt_entries.csv');
const outputFile = path.join(root, 'data/hpt-audit/corpus-state-index-discrepancies.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const split = value => [...new Set(String(value || '').split('|').map(item => item.trim()).filter(Boolean))];
const key = (url, hash) => `${normalizeUrl(url)}\0${hash}`;

function audit(state, rows) {
  const targets = Object.values(state.targets || {});
  const successful = new Set(targets.filter(item => item.status === 'ok' && item.finalUrl && item.sha256)
    .map(item => key(item.finalUrl, item.sha256)));
  const documents = new Map();
  for (const row of rows) {
    const id = key(row.final_url, row.pointer_sha256);
    if (!documents.has(id)) documents.set(id, []);
    documents.get(id).push(row);
  }
  const discrepancies = [];
  for (const [id, documentRows] of documents) {
    if (successful.has(id)) continue;
    const first = documentRows[0];
    const matchingTargets = targets.filter(item => key(item.finalUrl || item.lastSuccessful?.finalUrl,
      item.sha256 || item.lastSuccessful?.sha256) === id);
    const sameFinalTargets = targets.filter(item => item.finalUrl === first.final_url
      || item.lastSuccessful?.finalUrl === first.final_url);
    const successfulVersions = [...new Map(sameFinalTargets.filter(item => item.status === 'ok' && item.sha256)
      .map(item => [item.sha256, { sha256: item.sha256, fetched_at: item.fetchedAt || '' }])).values()];
    const matchedCcns = [...new Set(documentRows.flatMap(row => split(row.matched_ccns)))].sort();
    const relatedCcns = [...new Set(documentRows.flatMap(row => split(row.related_ccns)))].sort();
    discrepancies.push({
      pointer_url: first.pointer_url, final_url: first.final_url,
      pointer_sha256: first.pointer_sha256, raw_file: first.raw_file,
      fetched_at: first.fetched_at, entry_rows: documentRows.length,
      matched_ccns: matchedCcns, related_ccns: relatedCcns,
      target_statuses: [...new Set(matchingTargets.map(item => item.status))].sort(),
      successful_state_versions_for_final_url: successfulVersions,
      issue: matchingTargets.some(item => item.status === 'failed')
        ? 'index-version-with-failed-current-target'
          : successfulVersions.length ? 'index-hash-differs-from-successful-state'
            : 'index-version-without-successful-target',
      priority: matchedCcns.length ? 1 : 2,
      next_step: matchedCcns.length
        ? 'Reconcile each linked CCN against current pointer and file identity; retain older evidence as historical until independently corroborated.'
        : 'Reconcile the indexed version with crawl history and current first-party pointer before any facility assignment.'
    });
  }
  discrepancies.sort((a, b) => a.priority - b.priority || b.matched_ccns.length - a.matched_ccns.length
    || a.final_url.localeCompare(b.final_url));
  const affected = new Set(discrepancies.flatMap(item => item.matched_ccns));
  const byIssue = Object.fromEntries([...new Set(discrepancies.map(item => item.issue))].sort()
    .map(issue => [issue, discrepancies.filter(item => item.issue === issue).length]));
  return { summary: { corpus_documents: documents.size, corpus_rows: rows.length,
    documents_without_successful_target: discrepancies.length,
    rows_without_successful_target: discrepancies.reduce((total, item) => total + item.entry_rows, 0),
    matched_ccns_to_review: affected.size, by_issue: byIssue }, discrepancies };
}

function main() {
  const stateBytes = fs.readFileSync(stateFile);
  const indexBytes = fs.readFileSync(indexFile);
  const report = audit(JSON.parse(stateBytes), csvToObjects(indexBytes.toString('utf8')));
  for (const item of report.discrepancies) {
    const raw = path.resolve(root, item.raw_file || '');
    if (!item.raw_file || !raw.startsWith(root + path.sep) || !fs.existsSync(raw)) {
      item.retained_raw_status = 'missing-or-outside-workspace';
      continue;
    }
    item.retained_raw_sha256 = sha(fs.readFileSync(raw));
    item.retained_raw_status = item.retained_raw_sha256 === item.pointer_sha256
      ? 'hash-corroborated' : 'hash-conflict';
  }
  report.source_sha256 = { 'crawl-state.json': sha(stateBytes), 'cms_hpt_entries.csv': sha(indexBytes) };
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary));
}

if (require.main === module) main();
module.exports = { audit };
