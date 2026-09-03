#!/usr/bin/env node
/**
 * Emits data/hpt-audit/pointers.json - the published contract for downstream
 * consumers that want the chain structure without depending on this pipeline.
 *
 *   node scripts/export-pointers.js [sourceDir] [--out FILE] [--check]
 *
 * Why this file exists rather than "just read manifest.csv": manifest.csv is a
 * pipeline *output*, 28 columns wide, and its schema moves whenever matching is
 * tuned. Anything outside this repo that reads it breaks on a column rename it
 * never asked about. pointers.json is the narrow, deliberate surface instead -
 * the chain grouping and the four fields needed to draw it - so the manifest
 * stays free to change.
 *
 * A "chain" here is one cms-hpt.txt. That is the grouping CMS itself defines:
 * 45 CFR 180.50(d)(6) has a system publish one pointer file listing every
 * location it covers, so hospitals sharing a pointer_url are the same publisher
 * by the regulation's own definition, not by our guess about corporate structure.
 *
 * KNOWN GAP: manifest.csv holds only rows that matched a CCN, so this export
 * inherits that. A cms-hpt.txt naming a facility with no CCN in our roster -
 * a children's hospital inside a larger system, say - is invisible here. Those
 * live in the retained pointer snapshot (data/hpt-audit/pointers/*.txt). Its
 * contact-name and contact-email values are obfuscated at rest and decoded only
 * by the local server; see scripts/hpt/lib/pointer-obfuscation.js.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;

/* ---------- csv ---------- */

function parseCsv(text) {
  const rows = [];
  let field = '', row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function readTable(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const header = rows[0];
  return rows.slice(1)
    .filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((k, i) => [k, r[i]])));
}

/* ---------- fields ---------- */

/**
 * Normalize a URL's host for use as a graph key.
 *
 * Done once here, not by each consumer: "www.foo.org" and "foo.org" are the same
 * publisher, and if two consumers disagree about stripping www they draw two
 * different graphs from the same file.
 */
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); }
  catch (_e) { return null; }
}

const str = v => { const s = String(v == null ? '' : v).trim(); return s || null; };
const int = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
// manifest.csv writes yes/no; anything else (including blank) means "not known",
// which is not the same as "not stale" and must not collapse to false.
const bool = v => (v === 'yes' ? true : v === 'no' ? false : null);

function sourceHash(text) {
  const normalized = String(text).replace(/\r\n?/g, '\n');
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function facility(r) {
  return {
    ccn: str(r.ccn),
    name: str(r.hospital_name),
    city: str(r.city),
    state: str(r.state),
    // The name the hospital's own file gives itself, which is often not the
    // CMS roster name and is what a chain diagram should label the node with.
    locationName: str(r.location_name),
    mrfUrl: str(r.mrf_url),
    mrfHost: hostOf(r.mrf_url),
    sourcePageUrl: str(r.source_page_url),
    lastUpdated: str(r.mrf_last_updated),
    daysSinceUpdate: int(r.mrf_days_since_update),
    staleOver365: bool(r.mrf_stale_over_365),
    httpStatus: int(r.mrf_http_status)
  };
}

/* ---------- build ---------- */

function build(manifest) {
  const chains = new Map();
  const orphans = [];

  for (const r of manifest) {
    const pointerUrl = str(r.pointer_url);
    if (!pointerUrl) { orphans.push(facility(r)); continue; }
    if (!chains.has(pointerUrl)) {
      chains.set(pointerUrl, { pointerUrl, pointerHost: hostOf(pointerUrl), domains: new Set(), facilities: [] });
    }
    const c = chains.get(pointerUrl);
    if (str(r.domain)) c.domains.add(str(r.domain).replace(/^www\./i, '').toLowerCase());
    c.facilities.push(facility(r));
  }

  // Sorted so the committed file is a stable diff: a run that adds one hospital
  // shows one added line, not a reshuffle.
  const out = [...chains.values()].map(c => ({
    pointerUrl: c.pointerUrl,
    pointerHost: c.pointerHost,
    domains: [...c.domains].sort(),
    facilityCount: c.facilities.length,
    facilities: c.facilities.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)))
  }));
  out.sort((a, b) => b.facilityCount - a.facilityCount || a.pointerUrl.localeCompare(b.pointerUrl));
  orphans.sort((a, b) => String(a.ccn).localeCompare(String(b.ccn)));
  return { chains: out, orphans };
}

function resolveDir(explicit) {
  const candidates = [
    explicit,
    path.join(__dirname, '..', 'data', 'hpt-audit'),
    path.join(os.homedir(), 'Downloads'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'manifest.csv'))) return dir;
  }
  throw new Error('manifest.csv not found. Looked in:\n  ' + candidates.join('\n  '));
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const outIdx = argv.indexOf('--out');
  const outFile = outIdx >= 0
    ? argv[outIdx + 1]
    : path.join(__dirname, '..', 'data', 'hpt-audit', 'pointers.json');
  const srcDir = resolveDir(argv.find(a => !a.startsWith('--') && a !== outFile));
  const srcFile = path.join(srcDir, 'manifest.csv');

  const raw = fs.readFileSync(srcFile, 'utf8');
  // Git may check text files out with CRLF on Windows and LF on Linux. The
  // parsed manifest is identical in either case, so its provenance hash must
  // also describe that logical content instead of platform-specific bytes.
  const manifest = readTable(srcFile);
  const { chains, orphans } = build(manifest);

  const doc = {
    schemaVersion: SCHEMA_VERSION,
    // Provenance is the input's hash, not a wall-clock stamp, so the output is a
    // pure function of its input: re-running on unchanged data rewrites the same
    // bytes and shows no diff. The date this changed is what git log is for.
    source: {
      file: 'data/hpt-audit/manifest.csv',
      sha256: sourceHash(raw),
      rows: manifest.length
    },
    counts: {
      chains: chains.length,
      facilities: chains.reduce((n, c) => n + c.facilityCount, 0),
      multiFacilityChains: chains.filter(c => c.facilityCount > 1).length,
      facilitiesInMultiFacilityChains: chains.filter(c => c.facilityCount > 1)
        .reduce((n, c) => n + c.facilityCount, 0),
      orphans: orphans.length
    },
    chains,
    orphans
  };

  const json = JSON.stringify(doc, null, 1) + '\n';

  if (check) {
    const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    if (current !== json) {
      console.error(`${path.relative(process.cwd(), outFile)} is out of date. Run: npm run export:pointers`);
      process.exit(1);
    }
    console.log('pointers.json is up to date.');
    return;
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, json);

  const c = doc.counts;
  console.log(`-> ${path.relative(process.cwd(), outFile)}`);
  console.log(`   ${c.chains} chains, ${c.facilities} facilities, ${c.orphans} orphans`);
  console.log(`   ${c.multiFacilityChains} chains cover >1 facility (${c.facilitiesInMultiFacilityChains} facilities)`);
  console.log(`   ${(json.length / 1e6).toFixed(2)} MB`);
}

if (require.main === module) main();
module.exports = { build, hostOf, sourceHash, SCHEMA_VERSION };
