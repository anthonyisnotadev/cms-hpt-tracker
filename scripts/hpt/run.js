#!/usr/bin/env node
'use strict';
/**
 * CMS Hospital Price Transparency pointer + MRF harvester.
 *
 * Pipeline (each stage is resumable and writes into cms_data/hpt/):
 *   seed      build the hospital roster and seed domains from open data
 *   resolve   find domains for hospitals the seed did not cover (Exa)
 *   pointers  fetch /cms-hpt.txt per domain, escalating only when blocked
 *   match     map pointer entries to CCNs and emit the manifest
 *   download  fetch the MRFs listed in the manifest
 *   report    coverage summary
 *
 * Cost control is structural: one pointer file often covers a whole hospital
 * system, and the paid unblocker is only reached after a domain actually
 * refuses the free request.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');

// .env is a tracked file whose git-crypt filter is inert on this machine, so
// live credentials belong in .env.local (gitignored). Loaded second and
// allowed to override, so a key present in both wins from the untracked file.
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(ROOT_DIR, '.env') });
  dotenv.config({ path: path.join(ROOT_DIR, '.env.local'), override: true });
} catch (_e) {}

const { csvToObjects, toCSV, hostOf, isAggregator, JsonStore, pooled } = require('./lib/util');
const { fetchPointer, quickPointer, discoverViaFooter, directGet, unblockerGet, activeProvider } = require('./lib/fetch');
const { parsePointer, matchEntriesToHospitals, isPlausibleMrfUrl, guessFormat } = require('./lib/parse');
const { probeMrf } = require('./lib/probe');
const { fetchWikidata, wikidataCandidates, heuristicCandidates, orphanCandidates } = require('./lib/candidates');
const { searchHospitalDomains, activeSearchProvider } = require('./lib/search');
const { adjudicatePair, isAccepted } = require('./lib/adjudicate');
const { recoverViaLlm } = require('./lib/recover-llm');
const { protectPointerTextIfEnabled } = require('./lib/pointer-obfuscation');
const { nameSimilarity } = require('./lib/util');

const ROOT = ROOT_DIR;
const CMS_DATA = path.join(ROOT, 'cms_data');
const OUT = path.join(CMS_DATA, 'hpt');
const POINTER_DIR = path.join(OUT, 'pointers');
const MRF_DIR = path.join(OUT, 'mrf');

const HGI_CSV = path.join(CMS_DATA, 'Hospital_General_Information.csv');
const TPAFS_URL = 'https://raw.githubusercontent.com/TPAFS/transparency-data/main/price_transparency/hospitals/machine_readable_links.csv';

const F = {
  roster: path.join(OUT, 'roster.json'),
  domains: path.join(OUT, 'domains.json'),
  pointers: path.join(OUT, 'pointers.json'),
  resolved: path.join(OUT, 'resolved_domains.json'),
  manifest: path.join(OUT, 'manifest.csv'),
  manifestJson: path.join(OUT, 'manifest.json'),
  downloads: path.join(OUT, 'downloads.json'),
  unmatched: path.join(OUT, 'unmatched.json'),
  needsCorroboration: path.join(OUT, 'needs_corroboration.json'),
  dates: path.join(OUT, 'mrf_dates.json'),
  candidates: path.join(OUT, 'candidates.json'),
  ambiguous: path.join(OUT, 'ambiguous.json'),
  adjudicated: path.join(OUT, 'adjudicated.json'),
  verified: path.join(OUT, 'verified_domains.json'),
  gaps: path.join(OUT, 'gaps.csv'),
  compliance: path.join(OUT, 'compliance.csv')
};

function args() {
  const a = process.argv.slice(2);
  const cmd = a[0] || 'help';
  const opt = {};
  for (let i = 1; i < a.length; i++) {
    const m = a[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    opt[m[1]] = m[2] === undefined ? true : m[2];
  }
  return { cmd, opt };
}
const num = (v, d) => (v === undefined ? d : Number(v));
const log = (...m) => console.log(...m);

/**
 * The date probe deliberately reads only the first bytes of a file and then
 * drops the connection. Some HTTP/2 servers respond by closing the socket, and
 * undici raises that asynchronously as an 'error' event with no listener -
 * which terminates the process even though the request itself was already
 * handled. Losing a multi-hour resumable run to one host hanging up is not
 * acceptable, so exactly that class of error is absorbed and counted; anything
 * else still crashes loudly.
 */
const TRANSIENT_SOCKET_CODES = new Set([
  'UND_ERR_SOCKET', 'UND_ERR_ABORTED', 'UND_ERR_CONNECT_TIMEOUT',
  'ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ERR_HTTP2_STREAM_CANCEL'
]);
let transientSocketErrors = 0;
process.on('uncaughtException', (err) => {
  if (err && TRANSIENT_SOCKET_CODES.has(err.code)) { transientSocketErrors++; return; }
  console.error(err);
  process.exit(1);
});

function progressBar(label) {
  let last = 0;
  const tty = !!process.stdout.isTTY;
  // Without a TTY, carriage returns pile up as thousands of log lines, so fall
  // back to occasional milestone lines instead.
  const every = tty ? 400 : 15000;
  return (done, total, extra) => {
    const now = Date.now();
    if (now - last < every && done !== total) return;
    last = now;
    const pct = ((100 * done) / total).toFixed(1);
    const line = `${label} ${done}/${total} (${pct}%) ${extra || ''}`;
    if (tty) {
      process.stdout.write('\r' + line.padEnd(110).slice(0, 110));
      if (done === total) process.stdout.write('\n');
    } else {
      process.stdout.write(line + '\n');
    }
  };
}

const safeFile = s => String(s).replace(/[^a-z0-9._-]+/gi, '_').slice(0, 120);

const MANIFEST_COLS = [
  'ccn', 'hospital_name', 'city', 'state', 'type', 'domain', 'pointer_url', 'pointer_via',
  'location_name', 'mrf_url', 'source_page_url', 'extra_mrf_urls', 'mrf_format',
  'match_score', 'match_method',
  // Filled in by the `dates` stage.
  'mrf_last_updated', 'mrf_last_updated_raw', 'mrf_date_source', 'mrf_days_since_update',
  'mrf_stale_over_365', 'mrf_cms_version', 'mrf_bytes',
  'match_corroboration',
  'mrf_content_type', 'mrf_file_kind', 'mrf_http_status', 'mrf_checked_at',
  // Diagnostic only - deployment timestamp, NOT the date of record. See README.
  'mrf_http_last_modified_diagnostic'
];

/**
 * Fold probe results into manifest rows. Kept separate from the probing itself
 * so `match` and `dates` can run in either order without losing date columns.
 */
async function withDates(rows) {
  let dates = {};
  try { dates = JSON.parse(await fsp.readFile(F.dates, 'utf8')); } catch (_e) { return rows; }
  return rows.map(r => {
    const d = dates[r.mrf_url];
    if (!d) return r;
    // Derived here rather than read from the stored record, so records probed
    // under older rules cannot leak an HTTP-derived date into these columns.
    const declared = d.declaredLastUpdated || '';
    const days = declared
      ? Math.floor((Date.now() - new Date(declared + 'T00:00:00Z').getTime()) / 86400000)
      : '';
    return {
      ...r,
      mrf_last_updated: declared,
      mrf_last_updated_raw: d.declaredRaw || '',
      mrf_date_source: declared ? 'file-metadata' : '',
      mrf_days_since_update: days === '' ? '' : days,
      mrf_stale_over_365: days === '' ? '' : (days > 365 ? 'yes' : 'no'),
      mrf_http_last_modified_diagnostic: d.httpLastModified || '',
      mrf_cms_version: d.cmsVersion || '',
      mrf_bytes: d.bytes || '',
      mrf_content_type: d.contentType || '',
      mrf_file_kind: d.fileKind || '',
      // Some servers reject HEAD with 404/405 while serving the ranged GET.
      // Report the successful body-read status when available; that request is
      // also the one from which the declared date and template were parsed.
      mrf_http_status: d.rangeStatus >= 200 && d.rangeStatus < 300
        ? d.rangeStatus
        : (d.httpStatus === undefined ? '' : d.httpStatus),
      mrf_checked_at: d.checkedAt || ''
    };
  });
}

async function writeManifest(rows) {
  const merged = await withDates(rows);
  await fsp.writeFile(F.manifest, toCSV(merged, MANIFEST_COLS));
  await fsp.writeFile(F.manifestJson, JSON.stringify(merged, null, 1));
  return merged;
}

/* ------------------------------------------------------------------ seed -- */

async function cmdSeed(opt) {
  await fsp.mkdir(OUT, { recursive: true });

  log('Reading hospital roster...');
  const hgi = csvToObjects(await fsp.readFile(HGI_CSV, 'utf8'));
  const roster = hgi.map(r => ({
    ccn: String(r['Facility ID'] || '').trim(),
    name: r['Facility Name'] || '',
    address: r['Address'] || '',
    city: r['City/Town'] || '',
    state: r['State'] || '',
    zip: r['ZIP Code'] || '',
    phone: r['Telephone Number'] || '',
    type: r['Hospital Type'] || ''
  })).filter(h => h.ccn);
  await fsp.writeFile(F.roster, JSON.stringify(roster, null, 1));
  log(`  roster: ${roster.length} hospitals`);

  // Federally owned hospitals are outside 45 CFR 180's scope, so a missing
  // pointer file for them is expected rather than a gap to chase.
  const exempt = roster.filter(h => /Veterans Administration|Department of Defense/i.test(h.type));
  log(`  federal (rule-exempt, will be flagged): ${exempt.length}`);

  log('Fetching open MRF-link dataset for domain seeds...');
  const seedCsvPath = path.join(OUT, 'tpafs_links.csv');
  let seedText = '';
  if (fs.existsSync(seedCsvPath) && !opt.refresh) {
    seedText = await fsp.readFile(seedCsvPath, 'utf8');
    log('  using cached tpafs_links.csv (pass --refresh to re-download)');
  } else {
    const r = await directGet(TPAFS_URL, { timeoutMs: 60000 });
    if (r.status !== 200 || !r.body) throw new Error(`seed download failed: HTTP ${r.status}`);
    seedText = r.body;
    await fsp.writeFile(seedCsvPath, seedText);
    log(`  downloaded ${(seedText.length / 1e6).toFixed(1)} MB`);
  }

  const seedRows = csvToObjects(seedText);
  const byCcn = new Map();
  for (const row of seedRows) {
    let ccn = String(row.ccn || '').trim();
    if (!ccn) continue;
    if (ccn.length < 6) ccn = ccn.padStart(6, '0');
    if (!byCcn.has(ccn)) byCcn.set(ccn, row);
  }

  // The hospital's own site is what must host cms-hpt.txt, so prefer the
  // transparency page host and reject file-hosting/aggregator domains.
  const domains = new Map();
  const needResolve = [];
  for (const h of roster) {
    const row = byCcn.get(h.ccn);
    let d = '';
    if (row) {
      const dp = hostOf(row.machine_readable_page);
      if (dp && !isAggregator(dp)) d = dp;
      if (!d) {
        const du = hostOf(row.machine_readable_url);
        if (du && !isAggregator(du)) d = du;
      }
    }
    if (d) {
      if (!domains.has(d)) domains.set(d, { domain: d, ccns: [], source: 'open-data' });
      domains.get(d).ccns.push(h.ccn);
    } else {
      needResolve.push(h.ccn);
    }
  }

  // Preserve anything not derived from the seed dataset. Re-running seed after
  // an Exa pass or a hand-import must not silently discard that work.
  let carried = 0;
  try {
    const prior = JSON.parse(await fsp.readFile(F.domains, 'utf8'));
    for (const [d, meta] of Object.entries(prior)) {
      if (!meta || meta.source === 'open-data') continue;
      if (!domains.has(d)) { domains.set(d, meta); carried++; }
      else {
        const merged = domains.get(d);
        for (const c of meta.ccns || []) if (!merged.ccns.includes(c)) merged.ccns.push(c);
      }
    }
  } catch (_e) { /* first run */ }
  if (carried) log(`  carried forward ${carried} previously resolved/manual domains`);

  await fsp.writeFile(F.domains, JSON.stringify(Object.fromEntries(domains), null, 1));
  const covered = roster.length - needResolve.length;
  log('');
  log(`  seeded domains:     ${domains.size}`);
  log(`  hospitals covered:  ${covered} (${((100 * covered) / roster.length).toFixed(1)}%)`);
  log(`  need resolution:    ${needResolve.length}`);
  log('');
  log(`Next: node scripts/hpt/run.js pointers      (${domains.size} fetches, free)`);
  log(`  or: node scripts/hpt/run.js resolve       (${needResolve.length} lookups, needs EXA_API_KEY)`);
}

/* --------------------------------------------------------------- resolve -- */

async function exaSearch(query, numResults = 5) {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error('EXA_API_KEY not set');
  const r = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ query, numResults, type: 'auto' })
  });
  if (!r.ok) return { results: [], error: `exa http ${r.status}` };
  const j = await r.json();
  return { results: j.results || [] };
}

const BAD_DOMAIN = /(wikipedia|facebook|linkedin|yelp|indeed|glassdoor|healthgrades|usnews|medicare\.gov|cms\.gov|hospitalsafetygrade|vitals\.com|webmd|ratemds|npidb|hipaaspace|bloomberg|zoominfo|mapquest|tripadvisor|instagram|twitter|x\.com|youtube)/i;

async function cmdResolve(opt) {
  const roster = JSON.parse(await fsp.readFile(F.roster, 'utf8'));
  const domains = JSON.parse(await fsp.readFile(F.domains, 'utf8'));
  const covered = new Set(Object.values(domains).flatMap(d => d.ccns));
  const store = new JsonStore(F.resolved);
  await store.load();

  let todo = roster.filter(h => !covered.has(h.ccn) && !store.has(h.ccn));
  if (opt.skipFederal !== 'false') {
    todo = todo.filter(h => !/Veterans Administration|Department of Defense/i.test(h.type));
  }
  if (opt.limit) todo = todo.slice(0, num(opt.limit));

  if (!todo.length) { log('Nothing to resolve. All hospitals have a domain or a cached result.'); return; }
  log(`Resolving domains for ${todo.length} hospitals via Exa (already done: ${store.size})...`);

  const tick = progressBar('resolve');
  let found = 0;
  let saveCounter = 0;

  await pooled(todo, { concurrency: num(opt.concurrency, 5), onProgress: (d, t) => tick(d, t, `found=${found}`) },
    async (h) => {
      const q = `${h.name} hospital ${h.city} ${h.state} official website`;
      let best = null;
      try {
        const { results } = await exaSearch(q, 5);
        for (const res of results) {
          const d = hostOf(res.url);
          if (!d || BAD_DOMAIN.test(d) || isAggregator(d)) continue;
          best = d;
          break;
        }
      } catch (e) {
        store.set(h.ccn, { domain: null, error: String(e.message || e) });
        return;
      }
      store.set(h.ccn, best ? { domain: best, source: 'exa' } : { domain: null, reason: 'no-candidate' });
      if (best) found++;
      if (++saveCounter % 25 === 0) await store.save();
    });

  await store.save(true);

  // Fold newly resolved domains into the domain map for the pointer stage.
  for (const h of roster) {
    const r = store.get(h.ccn);
    if (!r || !r.domain) continue;
    if (!domains[r.domain]) domains[r.domain] = { domain: r.domain, ccns: [], source: 'exa' };
    if (!domains[r.domain].ccns.includes(h.ccn)) domains[r.domain].ccns.push(h.ccn);
  }
  await fsp.writeFile(F.domains, JSON.stringify(domains, null, 1));
  log(`Resolved ${found} new domains. Domain map now has ${Object.keys(domains).length} domains.`);
}

/* -------------------------------------------------------------- pointers -- */

async function cmdPointers(opt) {
  await fsp.mkdir(POINTER_DIR, { recursive: true });
  const domains = JSON.parse(await fsp.readFile(F.domains, 'utf8'));
  const store = new JsonStore(F.pointers);
  await store.load();

  const useUnblocker = opt.noUnblocker ? false : true;
  const prov = activeProvider();
  log(useUnblocker && prov
    ? `Unblocker: ${prov.name} (used only after a domain blocks the free request)`
    : 'Unblocker: none configured - free tier only, blocked domains will be recorded for a later pass');

  let list = Object.values(domains);
  if (!opt.retryFailed) list = list.filter(d => !store.has(d.domain));
  else list = list.filter(d => { const p = store.get(d.domain); return !p || !p.ok; });
  // Fetch the domains covering the most hospitals first so early runs buy the
  // most coverage per request.
  list.sort((a, b) => b.ccns.length - a.ccns.length);
  if (opt.limit) list = list.slice(0, num(opt.limit));

  if (!list.length) { log('No domains to fetch. Use --retryFailed to re-attempt failures.'); return; }
  log(`Fetching cms-hpt.txt for ${list.length} domains (cached: ${store.size})...`);

  let ok = 0, blocked = 0, notfound = 0, other = 0, saveCounter = 0;
  const tick = progressBar('pointers');

  await pooled(list, {
    concurrency: num(opt.concurrency, 12),
    keyFn: d => d.domain,
    onProgress: (d, t) => tick(d, t, `ok=${ok} blocked=${blocked} 404=${notfound} other=${other}`)
  }, async (d) => {
    const r = await fetchPointer(d.domain, { useUnblocker, timeoutMs: num(opt.timeout, 20000) });
    if (r.ok) {
      const parsed = parsePointer(r.body);
      const file = path.join(POINTER_DIR, safeFile(d.domain) + '.txt');
      await fsp.writeFile(file, protectPointerTextIfEnabled(r.body));
      store.set(d.domain, {
        ok: true, url: r.url, via: r.via, redirectedTo: r.redirectedTo || null,
        entries: parsed.entries.length, format: parsed.format,
        file: path.relative(ROOT, file), fetchedAt: new Date().toISOString()
      });
      ok++;
    } else {
      store.set(d.domain, {
        ok: false, reason: r.reason, canon: r.canon || null,
        // Whether the homepage answered separates "hospital site is up but
        // publishes no cms-hpt.txt" (a compliance finding) from "we could not
        // reach the site at all" (our problem, not theirs).
        homeStatus: r.homeStatus === undefined ? null : r.homeStatus,
        attempts: (r.attempts || []).map(a => `${a.kind}:${a.status}`),
        fetchedAt: new Date().toISOString()
      });
      if (r.reason === 'blocked') blocked++;
      else if (r.reason === 'notfound') notfound++;
      else other++;
    }
    if (++saveCounter % 20 === 0) await store.save();
  });

  await store.save(true);
  log('');
  log(`Pointers stored: ${ok} ok, ${blocked} blocked, ${notfound} not-found, ${other} other.`);
  log(`Raw files: ${path.relative(ROOT, POINTER_DIR)}`);
}

/* ----------------------------------------------------------------- match -- */

async function cmdMatch(opt) {
  const roster = JSON.parse(await fsp.readFile(F.roster, 'utf8'));
  const domains = JSON.parse(await fsp.readFile(F.domains, 'utf8'));
  const pointers = JSON.parse(await fsp.readFile(F.pointers, 'utf8'));
  const byCcn = new Map(roster.map(h => [h.ccn, h]));

  // Probe records carry each MRF's own address and licensing state, read from
  // the file header at no extra cost. Loaded up front because the per-domain
  // pass needs them too.
  let dateRecords = {};
  try { dateRecords = JSON.parse(await fsp.readFile(F.dates, 'utf8')); } catch (_e) {}

  const rows = [];
  const unmatched = { entriesWithoutHospital: [], hospitalsWithoutEntry: [] };
  const claimed = new Set();
  const orphans = [];
  const domainStates = new Map();
  let rejectedInDomainByState = 0;

  for (const [domain, meta] of Object.entries(domains)) {
    const p = pointers[domain];
    if (!p || !p.ok) continue;
    let body = '';
    try { body = await fsp.readFile(path.join(ROOT, p.file), 'utf8'); } catch (_e) { continue; }
    const { entries } = parsePointer(body);
    if (!entries.length) continue;

    const hospitals = meta.ccns.map(c => byCcn.get(c)).filter(Boolean);
    // Seed the domain's footprint from every hospital assigned to it, not just
    // the ones that matched, so the second pass has the widest honest bound.
    if (hospitals.length) {
      if (!domainStates.has(domain)) domainStates.set(domain, new Set());
      for (const h of hospitals) domainStates.get(domain).add(h.state);
    }
    const res = matchEntriesToHospitals(entries, hospitals, { threshold: Number(opt.threshold || 0.55) });

    for (const m of res.matches) {
      const e = entries[m.entryIndex];
      const h = byCcn.get(m.ccn);

      // A large system lists many same-named hospitals across states, so a
      // within-domain name match can still land on the wrong one. An audit found
      // every residual error came from this pass. If the file's own header names
      // a different state, return the entry to the orphan pool instead.
      const probe = e.mrfUrl ? dateRecords[e.mrfUrl] : null;
      if (probe && probe.mrfLicenseState && h && probe.mrfLicenseState !== h.state) {
        rejectedInDomainByState++;
        orphans.push({ domain, pointer: p, entry: e });
        continue;
      }

      claimed.add(m.ccn);
      if (!domainStates.has(domain)) domainStates.set(domain, new Set());
      domainStates.get(domain).add(h.state);
      rows.push({
        ccn: m.ccn, hospital_name: h.name, city: h.city, state: h.state, type: h.type,
        domain, pointer_url: p.url, pointer_via: p.via,
        location_name: e.locationName || '', mrf_url: e.mrfUrl || '',
        source_page_url: e.sourcePageUrl || '',
        extra_mrf_urls: (e.mrfUrls || []).slice(1).join(' | '),
        mrf_format: guessFormat(e.mrfUrl), match_score: m.score, match_method: m.method
      });
    }
    for (const i of res.unmatchedEntries) {
      orphans.push({ domain, pointer: p, entry: entries[i] });
    }
    for (const c of res.unmatchedHospitals) {
      const h = byCcn.get(c);
      if (h) unmatched.hospitalsWithoutEntry.push({ ccn: c, name: h.name, domain, reason: 'no matching entry in pointer file' });
    }
  }

  // Pointer files fetched but never linked to a CCN. `verify` only claims a
  // domain when an entry clears its threshold, so a hospital that renamed
  // itself - "Bullock County Hospital" publishing as "Bullock County Rural
  // Emergency Hospital" - leaves a perfectly good file stranded on disk. Feed
  // those entries into the same orphan pool so the evidence is at least
  // considered; with no footprint they carry no state assumption, and the
  // header check still guards them.
  let strandedDomains = 0, strandedEntries = 0;
  for (const [domain, p] of Object.entries(pointers)) {
    if (!p || !p.ok || domains[domain]) continue;
    let body = '';
    try { body = await fsp.readFile(path.join(ROOT, p.file), 'utf8'); } catch (_e) { continue; }
    const { entries } = parsePointer(body);
    if (!entries.length) continue;
    strandedDomains++;
    for (const e of entries) { orphans.push({ domain, pointer: p, entry: e }); strandedEntries++; }
  }

  // Second pass. A system's pointer file lists every location it owns, including
  // hospitals whose own domain we never seeded. Matching those leftover entries
  // against the whole unclaimed roster recovers them without a domain lookup.
  // The bar is deliberately high and the winner must be clearly ahead of the
  // runner-up, because names like "Memorial Hospital" repeat across states.
  const { strictSimilarity } = require('./lib/util');
  const globalThreshold = Number(opt.globalThreshold || 0.82);
  const strictFloor = Number(opt.strictFloor || 0.85);
  let recovered = 0, rejectedByState = 0, rejectedByStrict = 0, deferredForCorroboration = 0;
  const needsCorroboration = [];
  // Probe records carry each MRF's own address/licensing state, read from the
  // file header at no extra cost during the `dates` stage.
  // Verdicts already returned by `adjudicate`. Only affirmative high-confidence
  // rulings are stored, so anything present here is safe to accept outright.
  const adjudicated = new Map();
  try {
    const adj = JSON.parse(await fsp.readFile(F.adjudicated, 'utf8'));
    for (const [k, v] of Object.entries(adj)) if (v && v.accepted) adjudicated.set(k, v);
  } catch (_e) {}
  const ambiguous = [];
  const ambigLow = Number(opt.ambiguousFloor || 0.62);
  const pairKey = (domain, label) => `${domain}\0${label}`;
  let adjudicatedAccepts = 0;
  for (const o of orphans) {
    const label = o.entry.locationName || '';
    if (!label) { unmatched.entriesWithoutHospital.push({ domain: o.domain, locationName: label, mrfUrl: o.entry.mrfUrl }); continue; }

    // Rank against the whole unclaimed roster. Restricting the pool to the
    // domain's known states before ranking used to hide real matches: systems
    // acquire hospitals across state lines, so SHELBY BAPTIST (AL) legitimately
    // appears in an Orlando Health file served from a Florida domain.
    // Notes accumulate while candidates are tried and are only published if the
    // entry ends up unmatched; otherwise a successful fallback would also leave
    // a rejection record behind and inflate the orphan count.
    // An affirmative LLM ruling settles the pair; skip the score gauntlet that
    // rejected it in the first place.
    const verdict = adjudicated.get(pairKey(o.domain, label));
    if (verdict && !claimed.has(verdict.ccn)) {
      const h = byCcn.get(verdict.ccn);
      if (h) {
        claimed.add(h.ccn);
        recovered++; adjudicatedAccepts++;
        rows.push({
          ccn: h.ccn, hospital_name: h.name, city: h.city, state: h.state, type: h.type,
          domain: o.domain, pointer_url: o.pointer.url, pointer_via: o.pointer.via,
          location_name: label, mrf_url: o.entry.mrfUrl || '',
          source_page_url: o.entry.sourcePageUrl || '',
          extra_mrf_urls: (o.entry.mrfUrls || []).slice(1).join(' | '),
          mrf_format: guessFormat(o.entry.mrfUrl),
          match_score: verdict.score || 0,
          match_method: 'llm-adjudicated',
          match_corroboration: verdict.reason || ''
        });
        continue;
      }
    }

    const entryNotes = [];
    const states = domainStates.get(o.domain);
    const hasFootprint = !!(states && states.size);
    const inFp = h => !hasFootprint || states.has(h.state);

    // Rank globally and within the footprint at the same time. Keeping both is
    // what stops a cross-state name collision from crowding out the correct
    // in-state hospital: if the global winner cannot be corroborated we fall
    // back to the in-footprint one rather than abandoning the entry.
    let best = null, second = 0, bestFp = null, secondFp = 0;
    for (const h of roster) {
      if (claimed.has(h.ccn)) continue;
      const s = nameSimilarity(label, h.name);
      if (!best || s > best.score) { second = best ? best.score : second; best = { h, score: s }; }
      else if (s > second) second = s;
      if (inFp(h)) {
        if (!bestFp || s > bestFp.score) { secondFp = bestFp ? bestFp.score : secondFp; bestFp = { h, score: s }; }
        else if (s > secondFp) secondFp = s;
      }
    }
    if (!best) {
      unmatched.entriesWithoutHospital.push({
        domain: o.domain, locationName: label, mrfUrl: o.entry.mrfUrl,
        rejected: 'no unclaimed candidate in roster'
      });
      continue;
    }

    // Out-of-footprint candidates are the dangerous ones - "St Mary's Hospital"
    // exists in many states - so they must be corroborated by the MRF's own
    // header rather than excluded outright. The file states where it operates.
    let corroboration = null;
    const fallbackToFootprint = (reason, note) => {
      entryNotes.push({
        domain: o.domain, locationName: label, mrfUrl: o.entry.mrfUrl,
        rejected: note, bestGuess: `${best.h.ccn} ${best.h.name} (${best.score.toFixed(2)})`
      });
      if (reason === 'state') rejectedByState++;
      // Retry with the best in-footprint candidate, if there is a different one.
      if (bestFp && bestFp.h.ccn !== best.h.ccn) { best = bestFp; second = secondFp; return true; }
      return false;
    };

    // The file's own licensing state outranks the footprint heuristic in both
    // directions: it can rescue a legitimate out-of-state acquisition, and it
    // can veto an in-footprint name collision. Applied before the footprint
    // test so an in-footprint match cannot bypass contrary evidence.
    {
      const probe = o.entry.mrfUrl ? dateRecords[o.entry.mrfUrl] : null;
      if (probe && probe.mrfLicenseState && probe.mrfLicenseState !== best.h.state) {
        if (!fallbackToFootprint('state',
          `file declares state ${probe.mrfLicenseState}, hospital is ${best.h.state}`)) {
          unmatched.entriesWithoutHospital.push(...entryNotes); continue;
        }
        // The fallback candidate must satisfy the same evidence.
        if (probe.mrfLicenseState !== best.h.state) {
          unmatched.entriesWithoutHospital.push(...entryNotes); continue;
        }
        corroboration = `license_state=${probe.mrfLicenseState}`;
      }
    }

    if (!inFp(best.h)) {
      const probe = o.entry.mrfUrl ? dateRecords[o.entry.mrfUrl] : null;
      // A record written before the header fields existed has not actually been
      // read for this purpose; `undefined` means unknown, not "no state".
      const headerRead = probe && probe.mrfLicenseState !== undefined;
      if (!headerRead) {
        needsCorroboration.push({
          mrfUrl: o.entry.mrfUrl || '', domain: o.domain, locationName: label,
          candidateCcn: best.h.ccn, candidateName: best.h.name, candidateState: best.h.state,
          score: Number(best.score.toFixed(3))
        });
        deferredForCorroboration++;
        if (!fallbackToFootprint('defer',
          `out-of-footprint (${best.h.state} vs [${[...states].join(',')}]); awaiting header corroboration`)) {
          unmatched.entriesWithoutHospital.push(...entryNotes); continue;
        }
      } else {
        const addr = String(probe.mrfAddress || '').toUpperCase();
        const city = String(best.h.city || '').toUpperCase().replace(/[^A-Z ]/g, '').trim();
        if (probe.mrfLicenseState && probe.mrfLicenseState === best.h.state) {
          corroboration = `license_state=${probe.mrfLicenseState}`;
        } else if (probe.mrfLicenseState && probe.mrfLicenseState !== best.h.state) {
          if (!fallbackToFootprint('state',
            `file declares state ${probe.mrfLicenseState}, hospital is ${best.h.state}`)) {
            unmatched.entriesWithoutHospital.push(...entryNotes); continue;
          }
        } else if (addr && city && new RegExp(`\\b${best.h.state}\\b`).test(addr) && addr.includes(city)) {
          corroboration = 'address city+state';
        } else if (!fallbackToFootprint('state',
          `out-of-footprint and header does not corroborate (addr="${addr.slice(0, 60)}")`)) {
          unmatched.entriesWithoutHospital.push(...entryNotes); continue;
        }
      }
    }

    if (best && best.score >= globalThreshold && strictSimilarity(label, best.h.name) < strictFloor) {
      rejectedByStrict++;
      ambiguous.push({
        domain: o.domain, locationName: label, mrfUrl: o.entry.mrfUrl || '',
        ccn: best.h.ccn, score: Number(best.score.toFixed(3)), why: 'weak-strict-score'
      });
      unmatched.entriesWithoutHospital.push(...entryNotes, {
        domain: o.domain, locationName: label, mrfUrl: o.entry.mrfUrl,
        rejected: `strict-similarity ${strictSimilarity(label, best.h.name).toFixed(2)} below ${strictFloor}`,
        bestGuess: `${best.h.ccn} ${best.h.name} (${best.score.toFixed(2)})`
      });
      continue;
    }
    if (best && best.score >= globalThreshold && best.score - second >= 0.08) {
      claimed.add(best.h.ccn);
      recovered++;
      rows.push({
        ccn: best.h.ccn, hospital_name: best.h.name, city: best.h.city, state: best.h.state, type: best.h.type,
        domain: o.domain, pointer_url: o.pointer.url, pointer_via: o.pointer.via,
        location_name: label, mrf_url: o.entry.mrfUrl || '',
        source_page_url: o.entry.sourcePageUrl || '',
        extra_mrf_urls: (o.entry.mrfUrls || []).slice(1).join(' | '),
        mrf_format: guessFormat(o.entry.mrfUrl),
        match_score: Number(best.score.toFixed(3)),
        match_method: corroboration ? 'global-name+corroborated' : 'global-name',
        match_corroboration: corroboration || ''
      });
    } else {
      // Close but under the bar. These are the renames and re-brandings that a
      // string score cannot settle, so hand them to `adjudicate`.
      if (best && best.score >= ambigLow) {
        ambiguous.push({
          domain: o.domain, locationName: label, mrfUrl: o.entry.mrfUrl || '',
          ccn: best.h.ccn, score: Number(best.score.toFixed(3)), why: 'below-threshold'
        });
      }
      unmatched.entriesWithoutHospital.push(...entryNotes, {
        domain: o.domain, locationName: label, mrfUrl: o.entry.mrfUrl,
        bestGuess: best ? `${best.h.ccn} ${best.h.name} (${best.score.toFixed(2)})` : null
      });
    }
  }

  rows.sort((a, b) => a.ccn.localeCompare(b.ccn));
  await writeManifest(rows);
  await fsp.writeFile(F.unmatched, JSON.stringify(unmatched, null, 1));
  await fsp.writeFile(F.needsCorroboration, JSON.stringify(needsCorroboration, null, 1));
  await fsp.writeFile(F.ambiguous, JSON.stringify(ambiguous, null, 1));

  const withUrl = rows.filter(r => isPlausibleMrfUrl(r.mrf_url)).length;
  log(`Manifest: ${rows.length} hospitals matched, ${withUrl} with a usable MRF URL.`);
  log(`  coverage: ${((100 * claimed.size) / roster.length).toFixed(1)}% of ${roster.length} hospitals`);
  log(`  recovered by cross-domain name match: ${recovered} (no domain lookup needed)`);
  if (strandedDomains) log(`  unlinked pointer files folded in: ${strandedDomains} domains, ${strandedEntries} entries`);
  log(`  rejected: ${rejectedByState} header-contradicted, ${rejectedByStrict} weak-strict-score`);
  if (rejectedInDomainByState) log(`  in-domain matches rejected on header state: ${rejectedInDomainByState}`);
  if (deferredForCorroboration) log(`  deferred pending header read: ${deferredForCorroboration}  ->  run: corroborate`);
  if (adjudicatedAccepts) log(`  accepted from LLM adjudication: ${adjudicatedAccepts}`);
  if (ambiguous.length) log(`  ambiguous near-misses queued: ${ambiguous.length}  ->  run: adjudicate`);
  // One entry can leave several notes (a rejected cross-state winner plus the
  // in-footprint fallback that also failed), so count distinct entries.
  const distinctUnmatched = new Set(
    unmatched.entriesWithoutHospital.map(e => `${e.domain}\0${e.locationName}\0${e.mrfUrl || ''}`)
  ).size;
  log(`  pointer entries with no hospital match: ${distinctUnmatched}`);
  log(`  -> ${path.relative(ROOT, F.manifest)}`);
}

/* --------------------------------------------------------------- recover -- */

/**
 * For domains with no pointer file, fall back to the other half of the rule:
 * a homepage footer link to the standard-charges page. Results land in
 * footer_mrfs.json for review rather than straight into the manifest, because
 * a scraped link is weaker evidence than a hospital-declared mrf-url.
 *
 * `--llm` swaps the regex link-hunt for a model-guided two-hop crawl and a
 * corroboration gate; see cmdRecoverLlm.
 */
async function cmdRecover(opt) {
  if (opt.llm) return cmdRecoverLlm(opt);
  const domains = JSON.parse(await fsp.readFile(F.domains, 'utf8'));
  const pointers = JSON.parse(await fsp.readFile(F.pointers, 'utf8'));
  const store = new JsonStore(path.join(OUT, 'footer_mrfs.json'));
  await store.load();

  let list = Object.values(domains).filter(d => {
    const p = pointers[d.domain];
    return p && !p.ok && p.reason !== 'blocked' && !store.has(d.domain);
  });
  list.sort((a, b) => b.ccns.length - a.ccns.length);
  if (opt.limit) list = list.slice(0, num(opt.limit));
  if (!list.length) { log('No domains need footer recovery.'); return; }

  log(`Scanning ${list.length} pointer-less domains for footer price-transparency links...`);
  let found = 0, saveCounter = 0;
  const tick = progressBar('recover');
  await pooled(list, {
    concurrency: num(opt.concurrency, 8),
    keyFn: d => d.domain,
    onProgress: (d, t) => tick(d, t, `found=${found}`)
  }, async (d) => {
    const r = await discoverViaFooter(d.domain, { timeoutMs: num(opt.timeout, 20000) });
    store.set(d.domain, r.ok
      ? { ok: true, ccns: d.ccns, mrfUrls: r.mrfUrls, pagesScanned: r.pagesScanned, at: new Date().toISOString() }
      : { ok: false, reason: r.reason || 'no-mrf-links', at: new Date().toISOString() });
    if (r.ok) found++;
    if (++saveCounter % 20 === 0) await store.save();
  });
  await store.save(true);
  log('');
  log(`Found MRF links on ${found} of ${list.length} domains -> ${path.relative(ROOT, path.join(OUT, 'footer_mrfs.json'))}`);
}

/**
 * `recover --llm`: model-guided version of the footer hunt.
 *
 * Same input set as `recover` (a working site with no cms-hpt.txt), but instead
 * of a keyword regex it asks a model which nav links lead to the price page,
 * then which link on those pages is the machine-readable file. Every candidate
 * is then run through the header probe and the same state/name corroboration
 * the `match` stage uses. Accepted rows are written to recovered.csv in
 * manifest column order for review; the full record (including every rejected
 * and unconfirmed URL, with the reason) goes to recovered_mrfs.json.
 *
 * Nothing here writes the manifest and nothing reaches a paid unblocker.
 */
async function cmdRecoverLlm(opt) {
  if (!process.env.OPENROUTER_API_KEY) {
    log('OPENROUTER_API_KEY not set; nothing to do.');
    return;
  }
  const roster = JSON.parse(await fsp.readFile(F.roster, 'utf8'));
  const rosterByCcn = new Map(roster.map(h => [h.ccn, h]));
  const domains = JSON.parse(await fsp.readFile(F.domains, 'utf8'));
  const pointers = JSON.parse(await fsp.readFile(F.pointers, 'utf8'));
  let footer = {};
  try { footer = JSON.parse(await fsp.readFile(path.join(OUT, 'footer_mrfs.json'), 'utf8')); } catch (_e) {}

  const store = new JsonStore(path.join(OUT, 'recovered_mrfs.json'));
  await store.load();

  // A working site, no pointer file, not blocked, not already tried here, and
  // the cheap regex pass didn't already resolve it. Smallest domains first: a
  // real system almost always has a pointer file, so a pointer-less domain is
  // usually a single hospital that linked its file straight off its own site.
  let list = Object.values(domains).filter(d => {
    const p = pointers[d.domain];
    if (!p || p.ok || p.reason === 'blocked') return false;
    if (store.has(d.domain) && !opt.retryFailed) return false;
    const f = footer[d.domain];
    if (f && f.ok) return false;
    return true;
  });
  list.sort((a, b) => a.ccns.length - b.ccns.length);
  if (opt.limit) list = list.slice(0, num(opt.limit));
  if (!list.length) { log('No pointer-less domains left for LLM recovery.'); return; }

  log(`LLM footer recovery on ${list.length} domains (model: ${opt.model || process.env.OPENROUTER_MODEL || 'default'})...`);
  let found = 0, accepted = 0, saveCounter = 0;
  const tick = progressBar('recover-llm');
  await pooled(list, {
    concurrency: num(opt.concurrency, 4),
    keyFn: d => d.domain,
    onProgress: (d, t) => tick(d, t, `found=${found} accepted=${accepted}`)
  }, async (d) => {
    const hospitals = d.ccns.map(c => rosterByCcn.get(c)).filter(Boolean);
    if (!hospitals.length) {
      store.set(d.domain, { ok: false, reason: 'no-roster-rows', ccns: d.ccns, at: new Date().toISOString() });
      return;
    }
    let r;
    try {
      r = await recoverViaLlm({ domain: d.domain, hospitals }, {
        timeoutMs: num(opt.timeout, 25000),
        llmTimeoutMs: num(opt['llm-timeout'], 90000),
        model: opt.model
      });
    } catch (e) {
      r = { ok: false, reason: 'error', error: String((e && e.message) || e).slice(0, 160) };
    }
    store.set(d.domain, { ...r, ccns: d.ccns, at: new Date().toISOString() });
    if (r.mrfUrl) found++;
    if (r.ok) accepted++;
    if (++saveCounter % 10 === 0) await store.save();
  });
  await store.save(true);
  log('');

  // Manifest-shaped CSV of the accepted rows only.
  const rows = [];
  for (const [domain, r] of Object.entries(store.data)) {
    if (!r || !r.ok || !r.mrfUrl) continue;
    for (const ccn of r.ccns || []) {
      const h = rosterByCcn.get(ccn);
      if (!h) continue;
      rows.push({
        ccn, hospital_name: h.name, city: h.city, state: h.state, type: h.type,
        domain, pointer_url: '', pointer_via: 'llm-recover',
        location_name: (r.probe && r.probe.mrfHospitalName) || '',
        mrf_url: r.mrfUrl, source_page_url: r.sourcePageUrl || '', extra_mrf_urls: '',
        mrf_format: r.mrfFormat || guessFormat(r.mrfUrl),
        match_score: '', match_method: 'llm-recover',
        match_corroboration: r.corroboration || '',
        mrf_last_updated: (r.probe && r.probe.declaredLastUpdated) || '',
        mrf_last_updated_raw: (r.probe && r.probe.declaredRaw) || '',
        mrf_days_since_update: (r.probe && r.probe.daysSinceUpdate != null) ? r.probe.daysSinceUpdate : '',
        mrf_stale_over_365: (r.probe && r.probe.staleOver365) ? 'yes' : (r.probe && r.probe.declaredLastUpdated ? 'no' : ''),
        mrf_cms_version: (r.probe && r.probe.cmsVersion) || '',
        mrf_file_kind: (r.probe && r.probe.fileKind) || '',
        corroboration_confidence: r.corroborationConfidence || '',
        llm_confidence: r.llmConfidence || '',
        llm_reason: r.llmReason || ''
      });
    }
  }
  rows.sort((a, b) => a.state.localeCompare(b.state) || a.hospital_name.localeCompare(b.hospital_name));
  const outCsv = path.join(OUT, 'recovered.csv');
  await fsp.writeFile(outCsv, toCSV(rows));

  // Reason tally over what was rejected, so the failure modes are visible.
  const reasons = {};
  for (const r of Object.values(store.data)) reasons[r.reason || 'unknown'] = (reasons[r.reason || 'unknown'] || 0) + 1;
  log(`found an MRF link on ${found}/${list.length} domains; ${accepted} passed corroboration.`);
  log(`  outcomes: ${JSON.stringify(reasons)}`);
  log(`-> ${path.relative(ROOT, outCsv)}  (${rows.length} hospital rows -- review before importing)`);
  log(`-> ${path.relative(ROOT, path.join(OUT, 'recovered_mrfs.json'))}  (full detail, incl. rejected)`);
}

/* ----------------------------------------------------------------- dates -- */

/**
 * Record when each MRF was last updated, without downloading it.
 *
 * Two dates are captured because they answer different questions: the CMS
 * template's `last_updated_on` is the hospital's own compliance claim, while
 * HTTP Last-Modified is when the bytes actually changed. They frequently
 * disagree, and the gap is itself a finding.
 */
async function cmdDates(opt) {
  const rows = JSON.parse(await fsp.readFile(F.manifestJson, 'utf8'));
  const store = new JsonStore(F.dates);
  await store.load();

  const urls = [...new Set(rows.map(r => r.mrf_url).filter(u => isPlausibleMrfUrl(u)))];
  let list = urls;
  if (!opt.retryFailed) list = list.filter(u => !store.has(u));
  // Retry keys off the declared date, not a stored ok flag: records probed
  // before compressed files could be read were marked ok on weaker evidence,
  // and must be re-probed rather than trusted.
  else list = list.filter(u => { const d = store.get(u); return !d || !d.declaredLastUpdated; });
  if (opt.limit) list = list.slice(0, num(opt.limit));

  if (!list.length) {
    log('No new MRF URLs to probe; rewriting manifest with cached dates.');
    const merged = await writeManifest(rows);
    return summarizeDates(merged);
  }

  log(`Probing ${list.length} MRF URLs for dates (cached: ${store.size})...`);
  let ok = 0, blocked = 0, saveCounter = 0;
  const tick = progressBar('dates');

  await pooled(list, {
    concurrency: num(opt.concurrency, 10),
    keyFn: u => hostOf(u),
    onProgress: (d, t) => tick(d, t, `ok=${ok} blocked=${blocked}`)
  }, async (url) => {
    const r = await probeMrf(url, {
      timeoutMs: num(opt.timeout, 45000),
      useUnblocker: !opt.noUnblocker
    });
    store.set(url, r);
    if (r.ok) ok++;
    if (r.blocked) blocked++;
    if (++saveCounter % 25 === 0) await store.save();
  });

  await store.save(true);
  log('');
  log(`Probed ${list.length}: ${ok} dated, ${blocked} blocked.`);
  if (transientSocketErrors) log(`(absorbed ${transientSocketErrors} transient socket hang-ups)`);
  const merged = await writeManifest(rows);
  summarizeDates(merged);
  log(`-> ${path.relative(ROOT, F.manifest)}`);
}

function summarizeDates(rows) {
  const dated = rows.filter(r => r.mrf_last_updated);
  const stale = dated.filter(r => r.mrf_stale_over_365 === 'yes');
  const bySource = {};
  for (const r of dated) bySource[r.mrf_date_source] = (bySource[r.mrf_date_source] || 0) + 1;
  const years = {};
  for (const r of dated) {
    const y = String(r.mrf_last_updated).slice(0, 4);
    years[y] = (years[y] || 0) + 1;
  }
  log('');
  const withUrl = rows.filter(r => r.mrf_url).length;
  log(`rows with a declared date: ${dated.length}/${withUrl} probed URLs  ${JSON.stringify(bySource)}`);
  log(`rows with NO declared date (HTTP Last-Modified is not substituted): ${withUrl - dated.length}`);
  log(`stale (>365 days, 45 CFR 180.50 requires annual updates): ${stale.length}`);
  log('by declared year: ' + Object.entries(years).sort().map(([y, n]) => `${y}:${n}`).join('  '));
}

/* ------------------------------------------------------------ candidates -- */

/** Hospitals still needing a domain, excluding the federally exempt. */
async function hospitalsNeedingDomain() {
  const roster = JSON.parse(await fsp.readFile(F.roster, 'utf8'));
  let manifest = [];
  try { manifest = JSON.parse(await fsp.readFile(F.manifestJson, 'utf8')); } catch (_e) {}
  const matched = new Set(manifest.map(r => r.ccn));
  return roster.filter(h => !matched.has(h.ccn)
    && !/Veterans Administration|Department of Defense/i.test(h.type));
}

/**
 * Build the candidate-domain pool.
 *
 * Sources are stacked cheapest-first and all of them are guesses; the `verify`
 * stage is what decides. Running the free sources before the paid one is the
 * entire cost strategy.
 */
async function cmdCandidates(opt) {
  const want = String(opt.source || 'all').toLowerCase();
  const use = s => want === 'all' || want === s;
  const need = await hospitalsNeedingDomain();
  const store = new JsonStore(F.candidates);
  await store.load();

  const add = (ccn, list) => {
    if (!list || !list.length) return;
    const cur = store.get(ccn) || [];
    const seen = new Set(cur.map(c => c.domain));
    for (const c of list) {
      if (!c.domain || seen.has(c.domain) || isAggregator(c.domain)) continue;
      seen.add(c.domain);
      cur.push(c);
    }
    store.set(ccn, cur);
  };

  log(`${need.length} hospitals need a domain.`);

  if (use('wikidata')) {
    log('Fetching Wikidata hospital websites...');
    const { rows, error } = await fetchWikidata();
    if (error) log(`  wikidata failed: ${error}`);
    else {
      const map = wikidataCandidates(need, rows, { threshold: Number(opt.wikidataThreshold || 0.70) });
      let n = 0;
      for (const [ccn, list] of map) { add(ccn, list); n += list.length; }
      log(`  ${rows.length} wikidata rows -> ${n} candidates for ${map.size} hospitals`);
    }
  }

  if (use('orphan')) {
    let un = { entriesWithoutHospital: [] };
    try { un = JSON.parse(await fsp.readFile(F.unmatched, 'utf8')); } catch (_e) {}
    const orphans = un.entriesWithoutHospital.filter(o => o.locationName && o.domain);
    const map = orphanCandidates(need, orphans, { threshold: Number(opt.orphanThreshold || 0.60) });
    let n = 0;
    for (const [ccn, list] of map) { add(ccn, list); n += list.length; }
    log(`  ${orphans.length} orphan entries -> ${n} candidates for ${map.size} hospitals`);
  }

  if (use('heuristic')) {
    let n = 0;
    for (const h of need) {
      const list = heuristicCandidates(h, { maxPerHospital: num(opt.maxGuesses, 14) });
      add(h.ccn, list); n += list.length;
    }
    log(`  heuristic guesses -> ${n} candidates`);
  }

  if (use('search')) {
    const prov = activeSearchProvider();
    if (!prov) log('  search skipped: no provider configured (set HPT_SEARCH + credentials)');
    else {
      // Only spend a query on hospitals with no free candidate left to try.
      let todo = need.filter(h => !(store.get(h.ccn) || []).length);
      if (opt.limit) todo = todo.slice(0, num(opt.limit));
      log(`  ${prov.name}: searching ${todo.length} hospitals with no free candidate...`);
      let found = 0, saveCounter = 0;
      const tick = progressBar('search');
      await pooled(todo, { concurrency: num(opt.concurrency, 5), onProgress: (d, t) => tick(d, t, `found=${found}`) },
        async (h) => {
          const { domains, error } = await searchHospitalDomains(h, { num: 6 });
          if (error) return;
          const list = domains.slice(0, 4).map((d, i) => ({ domain: d, source: prov.name, score: 1 - i * 0.1 }));
          add(h.ccn, list);
          if (list.length) found++;
          if (++saveCounter % 25 === 0) await store.save();
        });
      log('');
    }
  }

  await store.save(true);
  const total = Object.values(store.data).reduce((a, b) => a + b.length, 0);
  const bySource = {};
  for (const list of Object.values(store.data)) for (const c of list) bySource[c.source] = (bySource[c.source] || 0) + 1;
  log('');
  log(`Candidate pool: ${total} candidates across ${store.size} hospitals  ${JSON.stringify(bySource)}`);
  log(`-> ${path.relative(ROOT, F.candidates)}   next: node scripts/hpt/run.js verify`);
}

/* ---------------------------------------------------------------- verify -- */

/**
 * Test candidate domains and keep the ones that prove themselves.
 *
 * A candidate is accepted only when the domain actually serves a pointer file
 * naming that hospital, so a wrong guess is discarded at the cost of one
 * request. Accepted domains are written into domains.json and the fetched file
 * is cached exactly as `pointers` would, so `match` picks it up unchanged.
 */
async function cmdVerify(opt) {
  await fsp.mkdir(POINTER_DIR, { recursive: true });
  const roster = JSON.parse(await fsp.readFile(F.roster, 'utf8'));
  const byCcn = new Map(roster.map(h => [h.ccn, h]));
  const candidates = JSON.parse(await fsp.readFile(F.candidates, 'utf8'));
  const domains = JSON.parse(await fsp.readFile(F.domains, 'utf8'));
  const pointers = new JsonStore(F.pointers);
  await pointers.load();
  const tried = new JsonStore(F.verified);
  await tried.load();

  // One domain can be proposed by many hospitals; fetch it once.
  const byDomain = new Map();
  for (const [ccn, list] of Object.entries(candidates)) {
    for (const c of list) {
      if (!byDomain.has(c.domain)) byDomain.set(c.domain, new Set());
      byDomain.get(c.domain).add(ccn);
    }
  }

  const accept = Number(opt.threshold || 0.72);
  let work = [...byDomain.entries()].map(([domain, ccns]) => ({ domain, ccns: [...ccns] }));
  // Skip anything already resolved or already tried, unless asked to redo.
  if (!opt.retryFailed) {
    work = work.filter(w => !pointers.has(w.domain) && !tried.has(w.domain));
  } else if (opt.onlyReason) {
    // Targeted retry. `neterr` in particular is often self-inflicted: a 60-domain
    // sample re-tested at low concurrency served a pointer file 25% of the time,
    // so those are worth another attempt while 404s and blocks are not.
    const want = new Set(String(opt.onlyReason).split(',').map(x => x.trim()));
    work = work.filter(w => {
      const t = tried.get(w.domain), p = pointers.get(w.domain);
      if ((p && p.ok) || (t && t.ok)) return false;
      const reason = (t && t.reason) || (p && p.reason);
      return reason && want.has(reason);
    });
  }
  if (opt.limit) work = work.slice(0, num(opt.limit));

  if (!work.length) { log('No candidate domains left to verify.'); return; }
  log(`Verifying ${work.length} candidate domains (free, one request each)...`);

  let hit = 0, linked = 0, saveCounter = 0;
  const tick = progressBar('verify');
  await pooled(work, {
    concurrency: num(opt.concurrency, 16),
    keyFn: w => w.domain,
    onProgress: (d, t) => tick(d, t, `pointers=${hit} hospitals=${linked}`)
  }, async (w) => {
    const r = await quickPointer(w.domain, { timeoutMs: num(opt.timeout, 10000) });
    if (!r.ok) { tried.set(w.domain, { ok: false, reason: r.reason, at: new Date().toISOString() }); return; }

    const parsed = parsePointer(r.body);
    hit++;
    const file = path.join(POINTER_DIR, safeFile(w.domain) + '.txt');
    await fsp.writeFile(file, protectPointerTextIfEnabled(r.body));
    pointers.set(w.domain, {
      ok: true, url: r.url, via: 'verify', redirectedTo: null,
      entries: parsed.entries.length, format: parsed.format,
      file: path.relative(ROOT, file), fetchedAt: new Date().toISOString()
    });

    // Link only hospitals the file actually names. `match` still applies the
    // full strictness rules afterwards; this just decides domain ownership.
    const names = parsed.entries.map(e => e.locationName || '');
    const matchedCcns = [];
    for (const ccn of w.ccns) {
      const h = byCcn.get(ccn);
      if (!h) continue;
      const best = Math.max(0, ...names.map(n => nameSimilarity(n, h.name)));
      if (best >= accept) matchedCcns.push({ ccn, score: Number(best.toFixed(3)) });
    }
    if (matchedCcns.length) {
      if (!domains[w.domain]) domains[w.domain] = { domain: w.domain, ccns: [], source: 'verified' };
      for (const m of matchedCcns) {
        if (!domains[w.domain].ccns.includes(m.ccn)) { domains[w.domain].ccns.push(m.ccn); linked++; }
      }
    }
    tried.set(w.domain, {
      ok: true, entries: parsed.entries.length,
      linked: matchedCcns, at: new Date().toISOString()
    });
    if (++saveCounter % 20 === 0) { await pointers.save(); await tried.save(); }
  });

  await pointers.save(true);
  await tried.save(true);
  await fsp.writeFile(F.domains, JSON.stringify(domains, null, 1));
  log('');
  log(`Verified: ${hit} domains served a pointer file; ${linked} hospitals linked to a domain.`);
  if (transientSocketErrors) log(`(absorbed ${transientSocketErrors} transient socket hang-ups)`);
  log('Next: node scripts/hpt/run.js match');
}

/* ------------------------------------------------------------ adjudicate -- */

/**
 * Rule on the near-misses that scoring cannot settle.
 *
 * These sit in a narrow band: the name is close but under the bar, usually
 * because a system renamed the hospital after acquiring it ("Baptist Health
 * Shelby Hospital" scores 0.77 against "SHELBY BAPTIST MEDICAL CENTER" and is
 * the same building). Address and licensing state read from the MRF header go
 * into the prompt, so the model rules on evidence rather than vibes. Only an
 * affirmative high-confidence verdict is stored as accepted - the manifest is
 * precision-first - and every verdict is cached so re-runs cost nothing.
 */
async function cmdAdjudicate(opt) {
  let queue = [];
  try { queue = JSON.parse(await fsp.readFile(F.ambiguous, 'utf8')); }
  catch (_e) { log('No ambiguous queue. Run `match` first.'); return; }
  if (!process.env.OPENROUTER_API_KEY) {
    log('OPENROUTER_API_KEY not set; nothing to do.');
    return;
  }

  const roster = JSON.parse(await fsp.readFile(F.roster, 'utf8'));
  const byCcn = new Map(roster.map(h => [h.ccn, h]));
  let dateRecords = {};
  try { dateRecords = JSON.parse(await fsp.readFile(F.dates, 'utf8')); } catch (_e) {}

  const store = new JsonStore(F.adjudicated);
  await store.load();

  const key = q => `${q.domain}\0${q.locationName}`;
  // Highest-scoring pairs first: they are the likeliest true renames.
  let todo = queue.filter(q => q.ccn && q.locationName && !store.has(key(q)));
  todo.sort((a, b) => b.score - a.score);
  if (opt.limit) todo = todo.slice(0, num(opt.limit));

  if (!todo.length) { log(`Nothing new to adjudicate (cached: ${store.size}).`); return; }

  // Read any MRF headers this queue still lacks. Ruling on two names with no
  // address or licensing state produced confident-but-wrong rejections, and the
  // header read is free, so evidence is gathered before anything is asked.
  const needHeader = [...new Set(todo.map(q => q.mrfUrl)
    .filter(u => isPlausibleMrfUrl(u) && (!dateRecords[u] || dateRecords[u].mrfLicenseState === undefined)))];
  if (needHeader.length && !opt.skipHeaders) {
    log(`Reading ${needHeader.length} missing MRF headers first (free)...`);
    const dstore = new JsonStore(F.dates);
    await dstore.load();
    let n = 0;
    const htick = progressBar('headers');
    await pooled(needHeader, {
      concurrency: num(opt.headerConcurrency, 8),
      keyFn: u => hostOf(u),
      onProgress: (d, t) => htick(d, t, '')
    }, async (url) => {
      const r = await probeMrf(url, { timeoutMs: 30000, useUnblocker: false });
      dstore.set(url, r);
      dateRecords[url] = r;
      if (++n % 25 === 0) await dstore.save();
    });
    await dstore.save(true);
    log('');
  }

  log(`Adjudicating ${todo.length} ambiguous pairs via OpenRouter (cached: ${store.size})...`);

  let accepted = 0, rejected = 0, failed = 0, saveCounter = 0;
  const tick = progressBar('adjudicate');
  await pooled(todo, {
    concurrency: num(opt.concurrency, 6),
    onProgress: (d, t) => tick(d, t, `yes=${accepted} no=${rejected} err=${failed}`)
  }, async (q) => {
    const h = byCcn.get(q.ccn);
    if (!h) return;
    const meta = q.mrfUrl ? (dateRecords[q.mrfUrl] || {}) : {};
    const v = await adjudicatePair(h, { locationName: q.locationName, domain: q.domain }, meta,
      { timeoutMs: num(opt.timeout, 45000) });
    if (!v || v.error) { failed++; return; }   // leave unresolved rather than record a guess
    const ok = isAccepted(v);
    store.set(key(q), {
      accepted: ok, ccn: q.ccn, hospitalName: h.name, locationName: q.locationName,
      domain: q.domain, score: q.score, match: v.match, confidence: v.confidence,
      reason: v.reason, model: v.model, at: new Date().toISOString()
    });
    if (ok) accepted++; else rejected++;
    if (++saveCounter % 20 === 0) await store.save();
  });

  await store.save(true);
  log('');
  log(`Adjudicated ${todo.length}: ${accepted} accepted, ${rejected} rejected, ${failed} errored.`);
  log('Only affirmative high-confidence verdicts are accepted.');
  log('Next: node scripts/hpt/run.js match');
}

/* ----------------------------------------------------------- corroborate -- */

/**
 * Read the file headers that `match` deferred on.
 *
 * These are cross-state candidates: the name matches, but the hospital is
 * outside the states that domain is known to serve. Rather than guess, `match`
 * queues the MRF URL and this stage reads its header - which states the
 * hospital's own address and licensing state - so the next `match` can decide
 * on evidence. Same free ranged read as `dates`.
 */
async function cmdCorroborate(opt) {
  let queue = [];
  try { queue = JSON.parse(await fsp.readFile(F.needsCorroboration, 'utf8')); }
  catch (_e) { log('No corroboration queue. Run `match` first.'); return; }

  const store = new JsonStore(F.dates);
  await store.load();

  let urls = [...new Set(queue.map(q => q.mrfUrl).filter(u => isPlausibleMrfUrl(u)))];
  // A record already carrying header fields needs no refetch.
  urls = urls.filter(u => { const d = store.get(u); return !d || d.mrfLicenseState === undefined; });
  if (opt.limit) urls = urls.slice(0, num(opt.limit));

  if (!urls.length) { log(`Nothing to corroborate (queue: ${queue.length}). Re-run \`match\`.`); return; }
  log(`Reading headers for ${urls.length} deferred candidates (free, ranged)...`);

  let withState = 0, saveCounter = 0;
  const tick = progressBar('corroborate');
  await pooled(urls, {
    concurrency: num(opt.concurrency, 8),
    keyFn: u => hostOf(u),
    onProgress: (d, t) => tick(d, t, `state=${withState}`)
  }, async (url) => {
    const r = await probeMrf(url, { timeoutMs: num(opt.timeout, 45000), useUnblocker: !opt.noUnblocker });
    store.set(url, r);
    if (r.mrfLicenseState) withState++;
    if (++saveCounter % 25 === 0) await store.save();
  });
  await store.save(true);

  log('');
  log(`Read ${urls.length} headers; ${withState} declared a licensing state.`);
  if (transientSocketErrors) log(`(absorbed ${transientSocketErrors} transient socket hang-ups)`);
  log('Now re-run: node scripts/hpt/run.js match');
}

/* -------------------------------------------------------------- download -- */

async function cmdDownload(opt) {
  await fsp.mkdir(MRF_DIR, { recursive: true });
  const rows = JSON.parse(await fsp.readFile(F.manifestJson, 'utf8'));
  const store = new JsonStore(F.downloads);
  await store.load();

  // One URL can serve many CCNs in a system; download it once.
  const byUrl = new Map();
  for (const r of rows) {
    if (!isPlausibleMrfUrl(r.mrf_url)) continue;
    if (!byUrl.has(r.mrf_url)) byUrl.set(r.mrf_url, []);
    byUrl.get(r.mrf_url).push(r.ccn);
  }
  let list = [...byUrl.entries()].map(([url, ccns]) => ({ url, ccns }));
  if (!opt.retryFailed) list = list.filter(x => !store.has(x.url));
  else list = list.filter(x => { const d = store.get(x.url); return !d || !d.ok; });
  if (opt.limit) list = list.slice(0, num(opt.limit));

  const maxMb = num(opt.maxMb, 512);
  if (!list.length) { log('Nothing to download.'); return; }
  log(`Downloading ${list.length} unique MRF files (covering ${new Set(rows.map(r => r.ccn)).size} hospitals), cap ${maxMb} MB each...`);

  let ok = 0, fail = 0, bytes = 0, saveCounter = 0;
  const tick = progressBar('download');

  await pooled(list, {
    concurrency: num(opt.concurrency, 6),
    keyFn: x => hostOf(x.url),
    onProgress: (d, t) => tick(d, t, `ok=${ok} fail=${fail} ${(bytes / 1e9).toFixed(2)}GB`)
  }, async (item) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), num(opt.timeout, 300000));
    const name = `${item.ccns[0]}_${safeFile(hostOf(item.url))}_${safeFile(path.basename(new URL(item.url).pathname) || 'mrf')}`;
    const dest = path.join(MRF_DIR, name.slice(0, 150));
    const tmp = dest + '.part';
    try {
      const { BROWSER_HEADERS } = require('./lib/fetch');
      let r = await fetch(item.url, { redirect: 'follow', signal: ac.signal, headers: BROWSER_HEADERS });

      // MRF hosts block too. Escalate the same way the pointer stage does:
      // only after the free attempt is actually refused.
      if ((r.status === 403 || r.status === 429) && !opt.noUnblocker && activeProvider()) {
        const alt = await unblockerGet(item.url, { timeoutMs: num(opt.timeout, 300000) });
        if (alt.status >= 200 && alt.status < 300 && alt.body) {
          await fsp.writeFile(dest, alt.body);
          const size = Buffer.byteLength(alt.body);
          bytes += size;
          store.set(item.url, {
            ok: true, file: path.relative(ROOT, dest), bytes: size,
            via: alt.via, ccns: item.ccns, at: new Date().toISOString()
          });
          ok++; return;
        }
      }
      if (!r.ok) { store.set(item.url, { ok: false, status: r.status, ccns: item.ccns }); fail++; return; }

      const len = Number(r.headers.get('content-length') || 0);
      if (len && len > maxMb * 1e6) {
        store.set(item.url, { ok: false, reason: 'too-large', bytes: len, ccns: item.ccns });
        fail++; return;
      }

      // Stream to disk. MRFs routinely exceed 300 MB, so buffering the whole
      // body would blow up memory once several downloads run in parallel.
      const cap = maxMb * 1e6;
      let written = 0, aborted = false;
      const out = fs.createWriteStream(tmp);
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        written += value.byteLength;
        if (written > cap) { aborted = true; try { await reader.cancel(); } catch (_e) {} break; }
        if (!out.write(Buffer.from(value))) await new Promise(res => out.once('drain', res));
      }
      await new Promise((res, rej) => { out.end(err => (err ? rej(err) : res())); });

      if (aborted) {
        await fsp.rm(tmp, { force: true });
        store.set(item.url, { ok: false, reason: 'too-large', bytes: written, ccns: item.ccns });
        fail++; return;
      }
      await fsp.rename(tmp, dest);
      bytes += written;
      store.set(item.url, {
        ok: true, file: path.relative(ROOT, dest), bytes: written,
        contentType: r.headers.get('content-type') || '', ccns: item.ccns, at: new Date().toISOString()
      });
      ok++;
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      store.set(item.url, { ok: false, error: String((e && e.message) || e) });
      fail++;
    } finally {
      clearTimeout(timer);
      if (++saveCounter % 10 === 0) await store.save();
    }
  });

  await store.save(true);
  log('');
  log(`Downloaded ${ok} files (${(bytes / 1e9).toFixed(2)} GB), ${fail} failed. -> ${path.relative(ROOT, MRF_DIR)}`);
}

/* ------------------------------------------------------------------ gaps -- */

/**
 * Emit the remediation worklist: every hospital not yet in the manifest, tagged
 * with what would actually fix it.
 *
 * The buckets exist because the fixes are not interchangeable. A blocked domain
 * does not need a new domain - sending it to a search API returns the same host
 * and spends money for nothing. A hospital whose system already publishes a
 * working pointer file does not need discovery at all; it needs its name
 * reconciled. Only genuinely missing or wrong domains are search problems.
 */
const REMEDIATION = {
  EXA: 'exa-domain-lookup',
  UNBLOCK: 'unblocker',
  NAME: 'name-match-review',
  PENDING: 'run-pointers-first',
  EXEMPT: 'exempt-federal'
};

async function cmdGaps(opt) {
  const roster = JSON.parse(await fsp.readFile(F.roster, 'utf8'));
  const domains = JSON.parse(await fsp.readFile(F.domains, 'utf8'));
  const pointers = JSON.parse(await fsp.readFile(F.pointers, 'utf8'));
  const manifest = JSON.parse(await fsp.readFile(F.manifestJson, 'utf8'));

  const matched = new Set(manifest.map(r => r.ccn));
  const domainOf = new Map();
  for (const [d, meta] of Object.entries(domains)) for (const c of meta.ccns) domainOf.set(c, d);

  const rows = [];
  for (const h of roster) {
    if (matched.has(h.ccn)) continue;

    const domain = domainOf.get(h.ccn) || '';
    const p = domain ? pointers[domain] : null;
    let remediation, reason;

    if (/Veterans Administration|Department of Defense/i.test(h.type)) {
      remediation = REMEDIATION.EXEMPT;
      reason = 'federally owned; outside 45 CFR 180';
    } else if (!domain) {
      remediation = REMEDIATION.EXA;
      reason = 'no domain in the seed dataset';
    } else if (!p) {
      remediation = REMEDIATION.PENDING;
      reason = 'domain seeded but pointers has not run on it yet';
    } else if (p.ok) {
      remediation = REMEDIATION.NAME;
      reason = `pointer file works (${p.entries} entries) but none matched this hospital's name`;
    } else if (p.reason === 'blocked') {
      remediation = REMEDIATION.UNBLOCK;
      reason = 'domain returned 403/429; needs the unblocker, not a new domain';
    } else {
      remediation = REMEDIATION.EXA;
      reason = `pointer fetch failed (${p.reason}); domain is likely wrong or stale`;
    }

    rows.push({
      ccn: h.ccn, hospital_name: h.name, address: h.address, city: h.city,
      state: h.state, zip: h.zip, phone: h.phone, type: h.type,
      seeded_domain: domain,
      pointer_status: p ? (p.ok ? 'ok' : p.reason) : (domain ? 'not-fetched' : 'no-domain'),
      remediation, reason,
      // Ready-to-use query for the search step.
      exa_query: remediation === REMEDIATION.EXA
        ? `${h.name} hospital ${h.city} ${h.state} official website`
        : '',
      resolved_domain: ''   // fill this in by hand, then: gaps --import=<file>
    });
  }

  const cols = ['ccn', 'hospital_name', 'address', 'city', 'state', 'zip', 'phone', 'type',
    'seeded_domain', 'pointer_status', 'remediation', 'reason', 'exa_query', 'resolved_domain'];

  await fsp.writeFile(F.gaps, toCSV(rows, cols));
  // A per-bucket file so each remediation path can be run independently.
  const buckets = {};
  for (const r of rows) (buckets[r.remediation] = buckets[r.remediation] || []).push(r);
  for (const [name, list] of Object.entries(buckets)) {
    await fsp.writeFile(path.join(OUT, `gaps_${name}.csv`), toCSV(list, cols));
  }
  // Remove bucket files from earlier runs that are now empty; a stale worklist
  // left on disk reads as outstanding work that no longer exists.
  for (const name of Object.values(REMEDIATION)) {
    if (buckets[name]) continue;
    await fsp.rm(path.join(OUT, `gaps_${name}.csv`), { force: true }).catch(() => {});
  }

  // Blocked work is per-domain, not per-hospital: one unblocked fetch can cover
  // a whole system, so pricing it per hospital overstates the cost.
  const blockedDomains = new Set(rows.filter(r => r.remediation === REMEDIATION.UNBLOCK).map(r => r.seeded_domain));

  log('');
  log(`=== remediation worklist: ${rows.length} hospitals not yet in the manifest ===`);
  for (const [name, list] of Object.entries(buckets).sort((a, b) => b[1].length - a[1].length)) {
    log(`  ${String(list.length).padStart(5)}  ${name}`);
  }
  log('');
  log(`  Exa lookups needed:        ${(buckets[REMEDIATION.EXA] || []).length}`);
  log(`  unblocker fetches needed:  ${blockedDomains.size} domains (not ${(buckets[REMEDIATION.UNBLOCK] || []).length} hospitals)`);
  log('');
  log(`-> ${path.relative(ROOT, F.gaps)} (plus one gaps_<bucket>.csv per path)`);
  if (buckets[REMEDIATION.PENDING]) {
    log('');
    log(`NOTE: ${buckets[REMEDIATION.PENDING].length} rows are only waiting on the free pointers pass.`);
    log('      Run `pointers` to completion before treating these as gaps.');
  }
}

/**
 * Read hand-corrected domains back out of a gaps CSV. Lets a human override the
 * search step for the cases it gets wrong, without editing JSON by hand.
 */
async function cmdGapsImport(file) {
  const rows = csvToObjects(await fsp.readFile(file, 'utf8'));
  const domains = JSON.parse(await fsp.readFile(F.domains, 'utf8'));
  let added = 0;
  for (const r of rows) {
    const d = hostOf(r.resolved_domain) || String(r.resolved_domain || '').trim().toLowerCase();
    if (!d || !r.ccn) continue;
    if (!domains[d]) domains[d] = { domain: d, ccns: [], source: 'manual' };
    if (!domains[d].ccns.includes(r.ccn)) { domains[d].ccns.push(r.ccn); added++; }
  }
  await fsp.writeFile(F.domains, JSON.stringify(domains, null, 1));
  log(`Imported ${added} hand-resolved domains. Now run: pointers && match`);
}

/* ------------------------------------------------------------ compliance -- */

/**
 * Classify every hospital against the observable requirements of 45 CFR 180.
 *
 * The central discipline here is separating *the hospital did not publish* from
 * *we could not find it*. Only the former is a finding. A hospital whose domain
 * we never resolved is recorded as `not-assessed`, never as non-compliant,
 * because the evidence is missing on our side, not theirs.
 *
 * Findings are stated as observations with the evidence attached and the date
 * checked, not as legal conclusions: a 403 to this client is evidence that
 * automated access was refused, which is worth reporting precisely because CMS
 * created the .txt requirement to make these files machine-readable - but it is
 * not proof of intent, and the report says so.
 */
const FINDING = {
  OK: 'compliant-observed',
  // File published and reachable, but its last_updated_on could not be read, so
  // the annual-update requirement cannot be judged either way.
  OK_NO_DATE: 'compliant-date-unverified',
  // The pointer file names this hospital but supplies no link to its MRF, which
  // 45 CFR 180.50(d)(6) requires the .txt file to provide.
  NO_MRF_URL: 'pointer-lists-no-mrf-url',
  // A domain WAS resolved and its pointer file WAS fetched; this hospital just
  // is not named in it. Distinct from having no domain at all: the evidence is
  // real, it simply does not settle the question either way.
  NOT_NAMED: 'not-assessed-not-named-in-file',
  STALE: 'mrf-stale-over-365-days',
  OLD_TEMPLATE: 'old-template-version',
  MRF_BLOCKED: 'mrf-blocked-to-automation',
  MRF_DEAD: 'mrf-url-unreachable',
  PTR_BLOCKED: 'pointer-blocked-to-automation',
  NO_PTR: 'no-cms-hpt-txt-published',
  SITE_DOWN: 'not-assessed-site-unreachable',
  NO_DOMAIN: 'not-assessed-domain-unknown',
  EXEMPT: 'not-applicable-federal'
};

async function cmdCompliance(opt) {
  const roster = JSON.parse(await fsp.readFile(F.roster, 'utf8'));
  const domains = JSON.parse(await fsp.readFile(F.domains, 'utf8'));
  const pointers = JSON.parse(await fsp.readFile(F.pointers, 'utf8'));
  const manifest = JSON.parse(await fsp.readFile(F.manifestJson, 'utf8'));
  let dates = {};
  try { dates = JSON.parse(await fsp.readFile(F.dates, 'utf8')); } catch (_e) {}

  const rowByCcn = new Map(manifest.map(r => [r.ccn, r]));
  const domainOf = new Map();
  for (const [d, meta] of Object.entries(domains)) for (const c of meta.ccns) domainOf.set(c, d);

  // "Site up but no cms-hpt.txt" is the headline finding, and it can only be
  // separated from "site unreachable" by asking the homepage. Records written
  // before homeStatus existed are filled in here - free, and usually a handful.
  const needHome = Object.entries(pointers)
    .filter(([, p]) => p && !p.ok && (p.reason === 'notfound' || p.reason === 'html')
      && (p.homeStatus === undefined || p.homeStatus === null))
    .map(([d]) => d);
  if (needHome.length && !opt.skipHomeCheck) {
    log(`Checking ${needHome.length} homepages to tell "no file published" from "site down"...`);
    const store = new JsonStore(F.pointers);
    await store.load();
    let n = 0;
    await pooled(needHome, { concurrency: num(opt.concurrency, 8), keyFn: d => d }, async (d) => {
      const r = await directGet(`https://${d}/`, { timeoutMs: 15000 });
      const rec = store.get(d) || pointers[d];
      rec.homeStatus = r.status;
      store.set(d, rec);
      pointers[d] = rec;
      if (++n % 20 === 0) await store.save();
    });
    await store.save(true);
    log('');
  }

  const out = [];
  for (const h of roster) {
    const row = rowByCcn.get(h.ccn);
    // The manifest is the authoritative record of what was concluded, and it
    // carries its own domain. domains.json is only the *input* list of domains
    // to go fetch, and the cross-domain and adjudicated match paths never write
    // back to it - so 402 fully matched hospitals looked domainless when this
    // asked the input store to describe the output.
    const domain = (row && row.domain) || domainOf.get(h.ccn) || '';
    const p = domain ? pointers[domain] : null;
    const probe = row && row.mrf_url ? dates[row.mrf_url] : null;

    let finding, evidence = '', assessable = true;

    if (/Veterans Administration|Department of Defense/i.test(h.type)) {
      finding = FINDING.EXEMPT;
      evidence = 'federally owned; outside 45 CFR 180';
      assessable = false;

    } else if (row) {
      // A manifest row means the pointer file was fetched AND confirmed to name
      // this hospital. The domain question is settled, so the only open question
      // is the state of the MRF it points to.
      if (!row.mrf_url) {
        finding = FINDING.NO_MRF_URL;
        evidence = `pointer file lists "${row.location_name}" but gives no mrf-url for it`;
      } else if (probe && probe.blocked && !row.mrf_last_updated
        && !(probe.rangeStatus >= 200 && probe.rangeStatus < 300)) {
        finding = FINDING.MRF_BLOCKED;
        evidence = `MRF URL refused automated access (HTTP ${probe.httpStatus})`;
      } else if (probe && probe.httpStatus && probe.httpStatus >= 400
        && !row.mrf_last_updated
        && !(probe.rangeStatus >= 200 && probe.rangeStatus < 300)) {
        finding = FINDING.MRF_DEAD;
        evidence = `MRF URL returned HTTP ${probe.httpStatus}`;
      } else if (row.mrf_stale_over_365 === 'yes') {
        finding = FINDING.STALE;
        evidence = `last_updated_on ${row.mrf_last_updated} is ${row.mrf_days_since_update} days old; 45 CFR 180.50 requires annual updates`;
      } else if (row.mrf_cms_version && !/^3\./.test(row.mrf_cms_version)) {
        finding = FINDING.OLD_TEMPLATE;
        evidence = `file declares CMS template version ${row.mrf_cms_version}`;
      } else if (!row.mrf_last_updated) {
        // Published and reachable, but currency unverified - do not claim both.
        finding = FINDING.OK_NO_DATE;
        evidence = 'cms-hpt.txt and MRF found, but last_updated_on could not be read';
      } else {
        finding = FINDING.OK;
        evidence = `cms-hpt.txt found; MRF last_updated_on ${row.mrf_last_updated}`;
      }

    } else if (!domain) {
      finding = FINDING.NO_DOMAIN;
      evidence = 'no domain resolved for this hospital; nothing was checked';
      assessable = false;
    } else if (p && !p.ok && p.reason === 'blocked') {
      finding = FINDING.PTR_BLOCKED;
      evidence = `https://${domain}/cms-hpt.txt refused automated access (${(p.attempts || []).join(', ')})`;
    } else if (p && !p.ok && (p.reason === 'notfound' || p.reason === 'html')) {
      // Only a finding if the site itself answered; otherwise we cannot tell.
      if (p.homeStatus && p.homeStatus >= 200 && p.homeStatus < 400) {
        finding = FINDING.NO_PTR;
        evidence = `site responded (HTTP ${p.homeStatus}) but no cms-hpt.txt at root or /.well-known/`;
      } else {
        finding = FINDING.SITE_DOWN;
        evidence = `no cms-hpt.txt found, and the site did not respond (HTTP ${p.homeStatus || 0})`;
        assessable = false;
      }
    } else if (p && !p.ok) {
      finding = FINDING.SITE_DOWN;
      evidence = `could not reach ${domain} (${p.reason})`;
      assessable = false;
    } else {
      finding = FINDING.NOT_NAMED;
      evidence = `a pointer file was fetched from ${domain}, but it does not name this hospital`;
      assessable = false;
    }

    out.push({
      ccn: h.ccn, hospital_name: h.name, city: h.city, state: h.state, type: h.type,
      finding, assessable: assessable ? 'yes' : 'no', evidence,
      domain, pointer_url: row ? row.pointer_url : (p && p.ok ? p.url : ''),
      mrf_url: row ? row.mrf_url : '',
      mrf_last_updated: row ? row.mrf_last_updated : '',
      mrf_days_since_update: row ? row.mrf_days_since_update : '',
      cms_template_version: row ? row.mrf_cms_version : '',
      checked_at: (row && row.mrf_checked_at) || (p && p.fetchedAt) || ''
    });
  }

  out.sort((a, b) => a.state.localeCompare(b.state) || a.hospital_name.localeCompare(b.hospital_name));
  const cols = ['ccn', 'hospital_name', 'city', 'state', 'type', 'finding', 'assessable', 'evidence',
    'domain', 'pointer_url', 'mrf_url', 'mrf_last_updated', 'mrf_days_since_update',
    'cms_template_version', 'checked_at'];
  await fsp.writeFile(F.compliance, toCSV(out, cols));

  const tally = {};
  for (const r of out) tally[r.finding] = (tally[r.finding] || 0) + 1;
  const assessed = out.filter(r => r.assessable === 'yes');
  // Publishing verified counts as compliant even when the date could not be
  // read; that is an unverified sub-requirement, not a violation.
  const COMPLIANT = new Set([FINDING.OK, FINDING.OK_NO_DATE]);
  const problems = assessed.filter(r => !COMPLIANT.has(r.finding));

  log('');
  log('=== Hospital price-transparency compliance ===');
  log(`hospitals assessed          ${assessed.length} of ${out.length}`);
  log(`  publishing verified       ${assessed.length - problems.length}`);
  log(`    of which date confirmed ${assessed.filter(r => r.finding === FINDING.OK).length}`);
  log(`  with a finding            ${problems.length}`);
  log('');
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    const mark = (k.startsWith('not-') || COMPLIANT.has(k)) ? '   ' : ' * ';
    log(`${mark}${String(v).padStart(5)}  ${k}`);
  }
  log('');
  log('  * = a finding about the hospital. Rows marked not-assessed are gaps in');
  log('    our evidence, not evidence against the hospital.');
  log(`-> ${path.relative(ROOT, F.compliance)}`);
}

/* ---------------------------------------------------------------- report -- */

async function cmdReport() {
  const read = async (f, d) => { try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch (_e) { return d; } };
  const roster = await read(F.roster, []);
  const domains = await read(F.domains, {});
  const pointers = await read(F.pointers, {});
  const manifest = await read(F.manifestJson, []);
  const downloads = await read(F.downloads, {});

  const covered = new Set(Object.values(domains).flatMap(d => d.ccns));
  const okDomains = Object.entries(pointers).filter(([, p]) => p.ok);
  const reasons = {};
  for (const [, p] of Object.entries(pointers)) if (!p.ok) reasons[p.reason] = (reasons[p.reason] || 0) + 1;
  const dl = Object.values(downloads);
  const bytes = dl.filter(d => d.ok).reduce((a, b) => a + (b.bytes || 0), 0);
  const matched = new Set(manifest.map(r => r.ccn));

  const pct = n => `${((100 * n) / (roster.length || 1)).toFixed(1)}%`;
  log('');
  log('=== CMS-HPT harvest status ===');
  log(`hospitals in dataset      ${roster.length}`);
  log(`  with a candidate domain ${covered.size}  ${pct(covered.size)}`);
  log(`domains                   ${Object.keys(domains).length}`);
  log(`  pointer fetched         ${okDomains.length}`);
  log(`  failed                  ${Object.keys(pointers).length - okDomains.length}  ${JSON.stringify(reasons)}`);
  log(`hospitals in manifest     ${matched.size}  ${pct(matched.size)}`);
  log(`MRF files downloaded      ${dl.filter(d => d.ok).length}  (${(bytes / 1e9).toFixed(2)} GB)`);
  log('');
  const missing = roster.filter(h => !matched.has(h.ccn));
  const byType = {};
  for (const h of missing) byType[h.type] = (byType[h.type] || 0) + 1;
  log(`still missing (${missing.length}) by type:`);
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => log(`  ${String(n).padStart(5)}  ${t}`));
}

/* ------------------------------------------------------------------ main -- */

const HELP = `
CMS-HPT harvester

  node scripts/hpt/run.js seed                 build roster + seed domains from open data
  node scripts/hpt/run.js resolve [--limit=N]  resolve remaining domains via Exa
  node scripts/hpt/run.js pointers [--limit=N] fetch /cms-hpt.txt per domain
  node scripts/hpt/run.js match                map entries to CCNs -> manifest.csv
  node scripts/hpt/run.js recover              footer-scan domains that had no pointer file
  node scripts/hpt/run.js recover --llm        model-guided crawl + corroboration -> recovered.csv
  node scripts/hpt/run.js candidates [--source=wikidata|orphan|heuristic|search|all]
                                               build the candidate-domain pool
  node scripts/hpt/run.js verify               test candidates for free, keep the ones that prove out
  node scripts/hpt/run.js adjudicate           LLM ruling on ambiguous name matches
  node scripts/hpt/run.js corroborate          read headers for deferred cross-state matches
  node scripts/hpt/run.js dates [--limit=N]    probe MRF last-updated dates (no full download)
  node scripts/hpt/run.js download [--limit=N] download the MRFs in the manifest
  node scripts/hpt/run.js gaps                 worklist of what is missing, routed by fix
  node scripts/hpt/run.js gaps --import=F.csv  read hand-corrected domains back in
  node scripts/hpt/run.js compliance           who publishes, who is stale, who blocks automation
  node scripts/hpt/run.js audit                check the outputs contradict nothing
  node scripts/hpt/run.js report               coverage summary

Common flags
  --concurrency=N   parallel workers (pointers 12, download 6, resolve 5)
  --limit=N         only process the first N items (for trial runs)
  --retryFailed     re-attempt previously failed items instead of new ones
  --onlyReason=R    with --retryFailed on verify: only retry this failure reason
                    (e.g. --onlyReason=neterr, which is often just concurrency)
  --noUnblocker     never spend money; free tier only
  --timeout=MS      per-request timeout
  --maxMb=N         skip MRF downloads larger than N megabytes (default 512)

Environment
  EXA_API_KEY                        domain resolution
  HPT_UNBLOCKER=oxylabs|decodo       which paid unblocker to use
  OXYLABS_USERNAME / OXYLABS_PASSWORD
  DECODO_USERNAME  / DECODO_PASSWORD

Every stage is resumable: re-running skips work already recorded.
`;

(async () => {
  const { cmd, opt } = args();
  try {
    switch (cmd) {
      case 'seed': return await cmdSeed(opt);
      case 'resolve': return await cmdResolve(opt);
      case 'pointers': return await cmdPointers(opt);
      case 'match': return await cmdMatch(opt);
      case 'recover': return await cmdRecover(opt);
      case 'candidates': return await cmdCandidates(opt);
      case 'verify': return await cmdVerify(opt);
      case 'adjudicate': return await cmdAdjudicate(opt);
      case 'corroborate': return await cmdCorroborate(opt);
      case 'dates': return await cmdDates(opt);
      case 'download': return await cmdDownload(opt);
      case 'gaps': return opt.import ? await cmdGapsImport(opt.import) : await cmdGaps(opt);
      case 'compliance': return await cmdCompliance(opt);
      case 'audit': return void require('./lib/audit').runAudit();
      case 'report': return await cmdReport(opt);
      default: return log(HELP);
    }
  } catch (e) {
    console.error('\nERROR:', (e && e.message) || e);
    process.exitCode = 1;
  }
})();
