#!/usr/bin/env node
'use strict';

/**
 * Convert a direct-MRF link inventory into the normalized MRF-corpus
 * contract used by probe-pointer-corpus.js.
 *
 * The source supplies useful CCN and URL leads, but it is not treated as proof. The
 * output leaves matched_ccns blank and places the claimed CCN in related_ccns;
 * a later ranged MRF-header probe must independently confirm the same facility
 * before import-corpus.js will accept it.
 */
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const { csvToObjects, hostOf, isAggregator, toCSV } = require('./lib/util');
const { isPlausibleMrfUrl } = require('./lib/parse');
const { CSV_COLUMNS, normalizeDomain, normalizeUrl, toRFC4180 } = require('./pointer-corpus');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_SOURCE = path.join(ROOT, 'cms_data', 'hpt', 'direct_mrf_links.csv');
const DEFAULT_OUT_DIR = path.join(ROOT, 'cms_data', 'hpt', 'new');
const REVIEW_COLUMNS = [
  'source_row', 'source_ccn', 'ccn', 'reporting_entity_name', 'source_state',
  'roster_state', 'mrf_url', 'source_page_urls', 'mrf_status', 'file_format',
  'disposition', 'reason'
];

function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) out[match[1]] = match[2] === undefined ? true : match[2];
  }
  return out;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeCcn(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (/^\d{1,6}$/.test(raw)) return raw.padStart(6, '0');
  const compact = raw.replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{6}$/.test(compact) && /[A-Z]/.test(compact) ? compact : '';
}

function splitUrls(...values) {
  const out = [];
  for (const value of values) {
    for (const raw of String(value || '').split('|')) {
      const url = normalizeUrl(raw);
      if (url && !out.includes(url)) out.push(url);
    }
  }
  return out;
}

function preferredDomains(pageUrls, mrfUrl) {
  const pageDomains = pageUrls.map(hostOf).map(normalizeDomain).filter(Boolean);
  const usable = pageDomains.filter(domain => !isAggregator(domain));
  const fallback = normalizeDomain(hostOf(mrfUrl));
  return [...new Set([...(usable.length ? usable : pageDomains), fallback].filter(Boolean))];
}

function sourceNames(row, hospital) {
  return [...new Set([
    row.reporting_entity_name_common,
    row.reporting_entity_name_legal,
    hospital && hospital.name
  ].map(value => String(value || '').trim()).filter(Boolean))];
}

function reviewRow(row, rowNumber, mappedCcn, hospital, disposition, reason) {
  return {
    source_row: rowNumber,
    source_ccn: String(row.ccn || '').trim(),
    ccn: mappedCcn || '',
    reporting_entity_name: sourceNames(row, hospital).join('|'),
    source_state: String(row.state_or_region || '').trim().toUpperCase(),
    roster_state: hospital && hospital.state || '',
    mrf_url: normalizeUrl(row.machine_readable_url),
    source_page_urls: splitUrls(row.machine_readable_page, row.supplemental_url).join('|'),
    mrf_status: String(row.machine_readable_url_status || '').trim(),
    file_format: String(row.file_format || '').trim(),
    disposition,
    reason
  };
}

function stageDirectMrfRows(rows, roster, manifest, options = {}) {
  const rosterByCcn = new Map(roster.map(hospital => [String(hospital.ccn || '').trim().toUpperCase(), hospital]));
  const covered = new Set(manifest.map(row => String(row.ccn || '').trim().toUpperCase()));
  const candidates = [];
  const review = [];
  const reasonCounts = {};
  const uniqueCcns = new Set();
  const uniqueUrls = new Set();
  const urlsByCcn = new Map();
  const sourceFile = options.sourceFile || 'cms_data/hpt/direct_mrf_links.csv';
  const sourceHash = options.sourceHash || '';

  const reject = (row, rowNumber, ccn, hospital, disposition, reason) => {
    review.push(reviewRow(row, rowNumber, ccn, hospital, disposition, reason));
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  };

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const ccn = normalizeCcn(row.ccn);
    if (!ccn) return reject(row, rowNumber, '', null, 'unmapped', 'missing-or-invalid-ccn');
    const hospital = rosterByCcn.get(ccn);
    if (!hospital) return reject(row, rowNumber, ccn, null, 'unmapped', 'ccn-not-in-current-cms-roster');
    if (!options.includeKnown && covered.has(ccn)) {
      return reject(row, rowNumber, ccn, hospital, 'skipped', 'already-in-manifest');
    }
    const sourceState = String(row.state_or_region || '').trim().toUpperCase();
    if (sourceState && hospital.state && sourceState !== hospital.state) {
      return reject(row, rowNumber, ccn, hospital, 'review', 'source-state-disagrees-with-roster');
    }
    const mrfUrl = normalizeUrl(row.machine_readable_url);
    if (!mrfUrl || !isPlausibleMrfUrl(mrfUrl)) {
      return reject(row, rowNumber, ccn, hospital, 'review', 'missing-or-invalid-mrf-url');
    }

    const pages = splitUrls(row.machine_readable_page, row.supplemental_url);
    const domains = preferredDomains(pages, mrfUrl);
    const names = sourceNames(row, hospital);
    candidates.push({
      record_status: 'mrf-url',
      pointer_url: '',
      final_url: '',
      observed_pointer_urls: '',
      pointer_host: domains[0] || '',
      pointer_format: '',
      pointer_sha256: sourceHash,
      raw_file: `${sourceFile}#row=${rowNumber}`,
      raw_bytes: '',
      fetched_at: '',
      fetch_via: 'direct-mrf-link',
      source_datasets: 'direct-mrf-links',
      source_domains: domains.join('|'),
      entry_index: rowNumber - 2,
      mrf_url_index: 0,
      location_name: names.join('|'),
      source_page_url: pages.join('|'),
      mrf_url: mrfUrl,
      contact_name: '',
      contact_email: '',
      extra_fields_json: JSON.stringify({
        reporting_entity_type: row.reporting_entity_type || '',
        machine_readable_url_status: row.machine_readable_url_status || '',
        file_name: row.file_name || '',
        file_format: row.file_format || '',
        file_size: row.file_size || '',
        meets_standard: row.meets_standard || '',
        standard_issue: row.standard_issue || '',
        state_or_region: row.state_or_region || '',
        last_updated_date: row.last_updated_date || '',
        entry_date: row.entry_date || '',
        notes: row.notes || ''
      }),
      matched_ccns: '',
      related_ccns: ccn
    });
    uniqueCcns.add(ccn);
    uniqueUrls.add(mrfUrl);
    if (!urlsByCcn.has(ccn)) urlsByCcn.set(ccn, new Set());
    urlsByCcn.get(ccn).add(mrfUrl);
  });

  const conflicts = [...urlsByCcn.entries()]
    .filter(([, urls]) => urls.size > 1)
    .map(([ccn, urls]) => ({ ccn, mrf_urls: [...urls].sort() }));
  const summary = {
    inputRows: rows.length,
    candidateRows: candidates.length,
    candidateCcns: uniqueCcns.size,
    uniqueMrfUrls: uniqueUrls.size,
    conflictingCcns: conflicts.length,
    reviewRows: review.length,
    reviewReasons: Object.fromEntries(Object.entries(reasonCounts).sort(([a], [b]) => a.localeCompare(b)))
  };
  return { candidates, review, conflicts, summary };
}

async function writeAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fsp.writeFile(temp, value);
  await fsp.rename(temp, file);
}

async function run(rawOptions = {}) {
  const sourceFile = path.resolve(rawOptions.input || DEFAULT_SOURCE);
  const outDir = path.resolve(rawOptions.out || DEFAULT_OUT_DIR);
  const rosterFile = path.resolve(rawOptions.roster || path.join(ROOT, 'cms_data', 'hpt', 'roster.json'));
  const manifestFile = path.resolve(rawOptions.manifest || path.join(ROOT, 'cms_data', 'hpt', 'manifest.json'));
  const entriesFile = path.join(outDir, 'direct_mrf_entries.csv');
  const reviewFile = path.join(outDir, 'direct_mrf_review.csv');
  const reportFile = path.join(outDir, 'direct_mrf_stage.json');
  const [sourceBytes, rosterBytes, manifestBytes] = await Promise.all([
    fsp.readFile(sourceFile), fsp.readFile(rosterFile), fsp.readFile(manifestFile)
  ]);
  const rows = csvToObjects(sourceBytes.toString('utf8').replace(/^\uFEFF/, ''));
  const roster = JSON.parse(rosterBytes.toString('utf8').replace(/^\uFEFF/, ''));
  const manifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''));
  const sourceHash = sha256(sourceBytes);
  const relativeSource = path.relative(ROOT, sourceFile).replace(/\\/g, '/');
  const staged = stageDirectMrfRows(rows, roster, manifest, {
    includeKnown: !!rawOptions['include-known'], sourceFile: relativeSource, sourceHash
  });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceFile,
    sourceSha256: sourceHash,
    includeKnown: !!rawOptions['include-known'],
    ...staged.summary,
    conflicts: staged.conflicts,
    entriesFile,
    reviewFile
  };
  await Promise.all([
    writeAtomic(entriesFile, toRFC4180(staged.candidates, CSV_COLUMNS)),
    writeAtomic(reviewFile, toCSV(staged.review, REVIEW_COLUMNS)),
    writeAtomic(reportFile, JSON.stringify(report, null, 1) + '\n')
  ]);
  const verified = csvToObjects(await fsp.readFile(entriesFile, 'utf8'));
  if (verified.length !== staged.candidates.length) {
    throw new Error(`Direct-MRF CSV reconciliation failed: wrote ${staged.candidates.length}, parsed ${verified.length}`);
  }
  return { ...report, reportFile };
}

if (require.main === module) {
  run(parseArgs()).then(summary => console.log(JSON.stringify(summary, null, 2))).catch(error => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { REVIEW_COLUMNS, parseArgs, normalizeCcn, splitUrls, stageDirectMrfRows, run };
