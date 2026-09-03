'use strict';

/**
 * Full-outer join the current hospital manifest to the harvested cms-hpt
 * pointer corpus. Facility joins come only from corpus `matched_ccns`; the
 * broader `related_ccns` field is deliberately never used for linkage.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const { parseCSV, csvToObjects } = require('./lib/util');
const { normalizeUrl, toRFC4180 } = require('./pointer-corpus');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_CORPUS = path.join(ROOT, 'cms_data', 'hpt', 'pointer-corpus', 'cms_hpt_entries.csv');
const DEFAULT_OUTPUT = path.join(ROOT, 'cms_data', 'hpt', 'pointer-corpus', 'cms_hpt_full_database.csv');
const MANIFEST_CANDIDATES = [
  path.join(ROOT, 'cms_data', 'hpt', 'manifest.csv'),
  path.join(ROOT, 'data', 'hpt-audit', 'manifest.csv')
];
const META_COLUMNS = [
  'combined_row_id', 'corpus_row_id', 'corpus_row_number', 'db_row_number',
  'joined_ccn', 'join_status', 'join_method', 'manifest_candidate_count',
  'manifest_match_count'
];

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) out[match[1]] = match[2] === undefined ? true : match[2];
  }
  return out;
}

async function exists(file) {
  try { await fsp.access(file); return true; }
  catch (_e) { return false; }
}

async function defaultManifest() {
  for (const file of MANIFEST_CANDIDATES) if (await exists(file)) return file;
  throw new Error(`No manifest found. Expected one of: ${MANIFEST_CANDIDATES.join(', ')}`);
}

function splitCcns(value) {
  return [...new Set(String(value || '').split('|').map(v => v.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function corpusRowId(row, rowNumber) {
  const sha = String(row.pointer_sha256 || '').trim() || 'no-sha';
  const entry = String(row.entry_index || '0').trim() || '0';
  const url = String(row.mrf_url_index || '0').trim() || '0';
  return `${sha}:${entry}:${url}:${rowNumber}`;
}

function prefixed(row, prefix, columns) {
  const out = {};
  for (const column of columns) out[`${prefix}${column}`] = row ? row[column] : '';
  return out;
}

function compareRows(a, b) {
  return String(a.join_status).localeCompare(String(b.join_status))
    || String(a.joined_ccn).localeCompare(String(b.joined_ccn))
    || Number(a.db_row_number || 0) - Number(b.db_row_number || 0)
    || Number(a.corpus_row_number || 0) - Number(b.corpus_row_number || 0)
    || String(a.combined_row_id).localeCompare(String(b.combined_row_id));
}

function combineRows(manifestRows, corpusRows, manifestColumns, corpusColumns) {
  const byCcn = new Map();
  manifestRows.forEach((row, index) => {
    const ccn = String(row.ccn || '').trim();
    if (!ccn) return;
    if (!byCcn.has(ccn)) byCcn.set(ccn, []);
    byCcn.get(ccn).push({ row, rowNumber: index + 1 });
  });

  const output = [];
  const usedManifestRows = new Set();

  function emit({ corpus, corpusNumber, database, ccn, status, method, candidates = 0, matches = 0 }) {
    const corpusId = corpus ? corpusRowId(corpus, corpusNumber) : '';
    const dbNumber = database ? database.rowNumber : '';
    const identity = corpusId || `database:${dbNumber}`;
    const combinedId = [identity, ccn || 'unmatched', dbNumber || 'no-db'].join(':');
    output.push({
      combined_row_id: combinedId,
      corpus_row_id: corpusId,
      corpus_row_number: corpusNumber || '',
      db_row_number: dbNumber,
      joined_ccn: ccn || '',
      join_status: status,
      join_method: method,
      manifest_candidate_count: candidates,
      manifest_match_count: matches,
      ...prefixed(database && database.row, 'db_', manifestColumns),
      ...prefixed(corpus, 'corpus_', corpusColumns)
    });
    if (database) usedManifestRows.add(database.rowNumber);
  }

  corpusRows.forEach((corpus, index) => {
    const corpusNumber = index + 1;
    const ccns = splitCcns(corpus.matched_ccns);
    if (!ccns.length) {
      emit({ corpus, corpusNumber, status: 'unmatched-corpus', method: 'none' });
      return;
    }

    for (const ccn of ccns) {
      const candidates = byCcn.get(ccn) || [];
      if (!candidates.length) {
        emit({ corpus, corpusNumber, ccn, status: 'ccn-not-in-current-database', method: 'exact-mrf-url' });
        continue;
      }

      const corpusMrf = normalizeUrl(corpus.mrf_url);
      const exact = corpusMrf
        ? candidates.filter(item => normalizeUrl(item.row.mrf_url) === corpusMrf)
        : [];

      if (exact.length) {
        for (const database of exact) {
          emit({
            corpus, corpusNumber, database, ccn,
            status: exact.length > 1 ? 'matched-duplicate-database-rows' : 'matched',
            method: 'exact-ccn+mrf-url', candidates: candidates.length,
            matches: exact.length
          });
        }
      } else if (candidates.length === 1) {
        emit({
          corpus, corpusNumber, database: candidates[0], ccn,
          status: 'matched-ccn-url-differs', method: 'exact-ccn',
          candidates: 1, matches: 1
        });
      } else {
        emit({
          corpus, corpusNumber, ccn, status: 'ambiguous-duplicate-ccn',
          method: 'none', candidates: candidates.length, matches: 0
        });
      }
    }
  });

  manifestRows.forEach((row, index) => {
    const rowNumber = index + 1;
    if (usedManifestRows.has(rowNumber)) return;
    emit({
      database: { row, rowNumber }, ccn: String(row.ccn || '').trim(),
      status: 'database-only', method: 'none', candidates: 1, matches: 0
    });
  });

  output.sort(compareRows);
  return output;
}

async function writeAtomic(file, contents) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, contents);
  await fsp.rename(tmp, file);
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) counts[row[key]] = (counts[row[key]] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function verifyCombined(rows, manifestRows, corpusRows) {
  const corpusNumbers = new Set(rows.map(row => Number(row.corpus_row_number)).filter(Boolean));
  const dbNumbers = new Set(rows.map(row => Number(row.db_row_number)).filter(Boolean));
  if (corpusNumbers.size !== corpusRows.length) {
    throw new Error(`Combined CSV represents ${corpusNumbers.size}/${corpusRows.length} corpus rows`);
  }
  if (dbNumbers.size !== manifestRows.length) {
    throw new Error(`Combined CSV represents ${dbNumbers.size}/${manifestRows.length} database rows`);
  }
  for (const row of rows) {
    if (row.db_row_number && row.joined_ccn !== row.db_ccn) {
      throw new Error(`CCN mismatch in combined row ${row.combined_row_id}`);
    }
    if (row.join_method === 'exact-ccn+mrf-url'
      && normalizeUrl(row.db_mrf_url) !== normalizeUrl(row.corpus_mrf_url)) {
      throw new Error(`MRF URL mismatch in combined row ${row.combined_row_id}`);
    }
  }
  return {
    outputRows: rows.length,
    corpusRowsRepresented: corpusNumbers.size,
    databaseRowsRepresented: dbNumbers.size
  };
}

async function readTable(file) {
  const text = (await fsp.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  return {
    rows: csvToObjects(text),
    columns: (parseCSV(text)[0] || []).map(value => value.trim())
  };
}

async function runCombine(options = {}) {
  const manifestFile = path.resolve(options.manifest || await defaultManifest());
  const corpusFile = path.resolve(options.corpus || DEFAULT_CORPUS);
  const outputFile = path.resolve(options.out || DEFAULT_OUTPUT);
  const [manifest, corpus] = await Promise.all([readTable(manifestFile), readTable(corpusFile)]);
  if (!manifest.columns.includes('ccn')) throw new Error(`Manifest is missing required ccn column: ${manifestFile}`);
  if (!corpus.columns.includes('matched_ccns')) throw new Error(`Corpus is missing required matched_ccns column: ${corpusFile}`);

  const combined = combineRows(manifest.rows, corpus.rows, manifest.columns, corpus.columns);
  const columns = [...META_COLUMNS, ...manifest.columns.map(c => `db_${c}`), ...corpus.columns.map(c => `corpus_${c}`)];
  await writeAtomic(outputFile, toRFC4180(combined, columns));

  const parsed = csvToObjects(await fsp.readFile(outputFile, 'utf8'));
  const verified = verifyCombined(parsed, manifest.rows, corpus.rows);
  return {
    manifestFile, corpusFile, outputFile,
    manifestRows: manifest.rows.length,
    corpusRows: corpus.rows.length,
    ...verified,
    statuses: countBy(parsed, 'join_status')
  };
}

async function main() {
  const summary = await runCombine(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}

module.exports = { META_COLUMNS, splitCcns, combineRows, verifyCombined, runCombine };
