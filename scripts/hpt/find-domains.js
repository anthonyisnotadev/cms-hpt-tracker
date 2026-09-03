#!/usr/bin/env node
'use strict';
/**
 * Find the website + price file for hospitals that have NEITHER yet.
 *
 *   node scripts/hpt/find-domains.js [options]
 *
 * Input: a CSV with columns ccn, hospital_name, address, city, state, zip, phone
 * (the shape of gaps_no_domain.csv / gaps.csv). Default:
 * data/hpt-audit/gaps_no_domain.csv
 *
 * Per hospital:
 *   1. heuristic domain guesses + optional bulk Wikidata websites (free),
 *      plus any seeded_domain already in the row
 *   2. one GET to /cms-hpt.txt per candidate. A file that parses AND names this
 *      hospital = VERIFIED. This is the pipeline's self-verifying trick: a wrong
 *      guess costs one request, a right one is proven on the spot.
 *   3. optionally search the web for official sites (`--search`) and verify
 *      those candidates the same way
 *   4. hospitals with no verified guess -> ask the model for domains, in
 *      batches, and verify those the same way
 *   5. still nothing, but a guessed homepage loads and clearly names the
 *      hospital -> "site-found" (its file is there somewhere; hand it to
 *      `run.js recover --llm`)
 *
 * Output: found_domains.csv next to the input.
 *   status = verified | site-found | unconfirmed | none
 *   resolved_domain is populated only for verified/site-found rows, so the
 *   CSV can be passed directly to `run.js gaps --import=...`.
 *
 * This never writes the manifest, domains.json, or outreach.json. It runs
 * without an API key (`--free` adds Wikidata to the heuristic pass).
 * OPENROUTER_MODEL / OPENROUTER_API_KEY are read from .env / .env.local like
 * the rest of the pipeline.
 *
 * Options
 *   --input FILE        input CSV (default data/hpt-audit/gaps_no_domain.csv)
 *   --limit N           only the first N hospitals
 *   --concurrency N     parallel /cms-hpt.txt checks (default 12)
 *   --llm-batch N       hospitals per model call (default 8)
 *   --llm-concurrency N parallel model calls (default 3)
 *   --timeout MS        per /cms-hpt.txt request (default 9000)
 *   --llm-timeout MS    per model call (default 90000)
 *   --min-score F       name-match threshold, pointer entry vs hospital (default 0.55)
 *   --free               heuristics + one bulk Wikidata lookup; disables LLM
 *                       (no key and no per-hospital search API)
 *   --wikidata           add official-site candidates from Wikidata
 *   --no-heuristics     skip name-slug guesses (useful when retrying cached
 *                       `none` rows with a new discovery source)
 *   --no-llm            skip model-proposed domains and adjudication
 *   --search            query the configured web-search provider after heuristics
 *                       (HPT_SEARCH=serper|decodo|exa)
 *   --search-results N  result domains requested per hospital (default 8)
 *   --search-concurrency N parallel search calls (default 5)
 *   --retry             re-process hospitals already in the cache
 *   --retry-status LIST re-process only cached statuses (for example: none
 *                       or none,site-found)
 *   --include-known     do NOT skip hospitals already in cms_data/outreach.json
 *                       (by default they are skipped: the gap list goes stale
 *                       against fieldwork you already did by hand)
 *   --model NAME        override OPENROUTER_MODEL
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(ROOT_DIR, '.env') });
  dotenv.config({ path: path.join(ROOT_DIR, '.env.local'), override: true });
} catch (_e) {}

const dns = require('dns');

const { csvToObjects, toCSV, hostOf, isAggregator, normalizeName, nameSimilarity, JsonStore, pooled } = require('./lib/util');
const { quickPointer, directGet } = require('./lib/fetch');
const { probeMrf } = require('./lib/probe');
const { parsePointer } = require('./lib/parse');
const { fetchWikidata, wikidataCandidates, heuristicCandidates, llmDomainCandidates } = require('./lib/candidates');
const { adjudicatePair, isAccepted } = require('./lib/adjudicate');
const { searchHospitalDomains, activeSearchProvider } = require('./lib/search');

const num = (v, d) => (v === undefined ? d : Number(v));
const log = (...m) => console.log(...m);

function parseArgs() {
  const a = process.argv.slice(2);
  const opt = {};
  for (let i = 0; i < a.length; i++) {
    const m = a[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    let v = m[2];
    if (v === undefined) {
      const next = a[i + 1];
      v = (next !== undefined && !next.startsWith('--')) ? (i++, next) : true;
    }
    opt[m[1]] = v;
  }
  return opt;
}

const GENERIC_TOK = new Set(['hospital', 'hospitals', 'medical', 'center', 'centre', 'health', 'healthcare',
  'regional', 'community', 'memorial', 'general', 'system', 'clinic', 'the', 'of', 'inc', 'llc', 'corp',
  'saint', 'st', 'county', 'district', 'district-wide', 'and']);

/** Distinctive lowercased tokens of a hospital name (drops the boilerplate words). */
function coreTokens(name) {
  return [...new Set(normalizeName(name).split(' ').filter(t => t && t.length > 2 && !GENERIC_TOK.has(t)))];
}

function visibleText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Does this hostname exist at all?
 *
 * Most slug guesses are NXDOMAIN, and an HTTP request to one burns the full
 * timeout before failing, so this is the difference between hours and minutes
 * across ~13,000 guesses.
 *
 * It must NOT use dns.lookup(): that goes through the OS resolver, which
 * ignores any timeout and measured 11 SECONDS per NXDOMAIN on this machine,
 * worse than the HTTP request it was meant to replace. dns.Resolver is c-ares
 * and honours `timeout`/`tries`, which brought the same lookups to ~20ms.
 * Cached per process because the same guess recurs across hospitals.
 */
const RESOLVER = new dns.promises.Resolver({ timeout: 1500, tries: 1 });
const dnsCache = new Map();
async function resolves(domain) {
  const d = String(domain).replace(/^www\./, '');
  if (dnsCache.has(d)) return dnsCache.get(d);
  const hit = async h => { try { const a = await RESOLVER.resolve4(h); return !!(a && a.length); } catch (_e) { return false; } };
  // Some hosts publish A records only on www.
  const ok = (await hit(d)) || (await hit('www.' + d));
  dnsCache.set(d, ok);
  return ok;
}

/**
 * Verify one candidate domain for one hospital: fetch /cms-hpt.txt, and if it
 * parses, check whether any location entry names this hospital.
 */
async function verifyDomain(domain, job, minScore, timeoutMs) {
  if (!(await resolves(domain))) return { domain, ok: false, reason: 'nxdomain' };
  const r = await quickPointer(domain, { timeoutMs });
  if (!r.ok) return { domain, ok: false, reason: r.reason || 'no-pointer' };
  const { entries } = parsePointer(r.body);
  if (!entries.length) return { domain, ok: false, reason: 'pointer-unparseable' };

  let best = null;
  for (const e of entries) {
    const s = nameSimilarity(e.locationName || '', job.name || '');
    if (!best || s > best.score) {
      best = { score: s, locationName: e.locationName || '', mrfUrl: e.mrfUrl || (e.mrfUrls && e.mrfUrls[0]) || '', sourcePageUrl: e.sourcePageUrl || '' };
    }
  }
  if (best && best.score >= minScore) {
    return {
      domain, ok: true, pointerUrl: r.url, entryCount: entries.length,
      matchScore: Number(best.score.toFixed(3)), matchedLocationName: best.locationName,
      mrfUrl: best.mrfUrl, sourcePageUrl: best.sourcePageUrl
    };
  }
  // The file works but lists other hospitals -- a system domain, not this one.
  return { domain, ok: false, reason: 'pointer-names-others', entryCount: entries.length, bestScore: Number((best ? best.score : 0).toFixed(3)) };
}

/**
 * Second gate on a name match: the MRF header's own declared licensing state.
 *
 * A name match against a SPECULATIVE domain is far weaker evidence than one
 * inside a domain already assigned to the hospital, so the 0.55 threshold that
 * is safe in `match` produces confident nonsense here: "TEXAS COUNTY MEMORIAL
 * HOSPITAL" (MO) scores 0.55 against "Texas Health Arlington Memorial Hospital"
 * on shared tokens alone, and two different Kentucky hospitals both matched the
 * same generic "University Hospital" entry.
 *
 * The CMS template makes every file declare `license_number|<ST>`, so one
 * ranged read of the header settles it for free. This is the same ladder the
 * `match`/`corroborate` stages climb.
 */
async function confirmState(rec, job, timeoutMs) {
  if (!rec.mrf_url) return { ok: false, conf: 'low', why: 'no mrf-url in the pointer entry to check' };
  let p = null;
  try { p = await probeMrf(rec.mrf_url, { timeoutMs, useUnblocker: false }); } catch (_e) { /* treated as unreadable */ }

  const st = p && p.mrfLicenseState;
  if (st) {
    return st === job.state
      ? { ok: true, conf: 'high', why: `MRF header license state ${st} matches`, probe: p }
      : { ok: false, conf: 'high', why: `MRF header license state ${st} != hospital state ${job.state}`, probe: p };
  }
  const hn = p && p.mrfHospitalName;
  if (hn) {
    const s = nameSimilarity(hn, job.name);
    return s >= 0.6
      ? { ok: true, conf: 'medium', why: `no license state; MRF hospital_name "${hn}" ~ roster (${s.toFixed(2)})`, probe: p }
      : { ok: false, conf: 'medium', why: `no license state; MRF hospital_name "${hn}" does not match roster (${s.toFixed(2)})`, probe: p };
  }
  // Header unreadable or carries no identifying field: fall back to how strong
  // the pointer-entry name match was in the first place.
  return Number(rec.matchScore) >= 0.85
    ? { ok: true, conf: 'low', why: 'no identifying field in the MRF header; accepted on a strong pointer name match', probe: p }
    : { ok: false, conf: 'low', why: 'no identifying field in the MRF header and the pointer name match is weak', probe: p };
}

/** Weak fallback: does a guessed homepage clearly belong to this hospital? */
async function siteMentions(domain, job, timeoutMs) {
  if (!(await resolves(domain))) return null;
  const r = await directGet(`https://${domain.replace(/^www\./, '')}/`, { timeoutMs });
  if (!r.body) return null;
  const text = visibleText(r.body);
  const toks = coreTokens(job.name);
  const nameHit = toks.some(t => text.includes(t));
  const placeHit = (job.city && text.includes(job.city.toLowerCase())) || (job.state && new RegExp(`\\b${job.state.toLowerCase()}\\b`).test(text));
  if (nameHit && placeHit) {
    const title = (r.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].replace(/\s+/g, ' ').trim().slice(0, 140);
    return { domain: hostOf(r.finalUrl) || domain, homepageTitle: title };
  }
  return null;
}

function candidateDomains(job) {
  const out = [];
  if (job.seeded) out.push(job.seeded.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase());
  for (const c of heuristicCandidates({ name: job.name }, { maxPerHospital: 12 })) out.push(c.domain);
  const seen = new Set();
  return out.filter(d => d && !isAggregator(d) && !seen.has(d) && seen.add(d));
}

async function main() {
  const opt = parseArgs();
  if (opt.free) {
    opt.wikidata = true;
    opt['no-llm'] = true;
  }
  if (opt.help || opt.h) {
    const doc = fs.readFileSync(__filename, 'utf8');
    log(doc.slice(doc.indexOf('/**') + 3, doc.indexOf('*/')).replace(/^ \* ?/gm, '').trim());
    return;
  }

  const inputPath = path.resolve(opt.input ? String(opt.input) : path.join(ROOT_DIR, 'data', 'hpt-audit', 'gaps_no_domain.csv'));
  let rows;
  try {
    rows = csvToObjects(await fsp.readFile(inputPath, 'utf8'));
  } catch (_e) {
    log(`Cannot read ${path.relative(ROOT_DIR, inputPath)}`);
    log('Point --input at gaps.csv or gaps_no_domain.csv.');
    process.exitCode = 1;
    return;
  }
  const outPath = path.join(path.dirname(inputPath), 'found_domains.csv');
  const cachePath = path.join(path.dirname(inputPath), 'find_domains.json');

  // The gap list is a snapshot; fieldwork logged since then already answered
  // some of it. Skip anything with an outreach record unless asked not to.
  let known = new Set();
  if (!opt['include-known']) {
    try {
      const o = JSON.parse(await fsp.readFile(path.join(ROOT_DIR, 'cms_data', 'outreach.json'), 'utf8'));
      known = new Set(Object.keys(o));
    } catch (_e) { /* no private log on this machine; nothing to skip */ }
  }

  const jobs = rows
    .filter(r => r.ccn && r.hospital_name && !known.has(r.ccn))
    .map(r => ({
      ccn: r.ccn, name: r.hospital_name, address: r.address || '', city: r.city || '',
      state: r.state || '', zip: r.zip || '', phone: r.phone || '',
      seeded: (r.seeded_domain || r.resolved_domain || '').trim()
    }));

  const cache = new JsonStore(cachePath);
  await cache.load();
  const retryStatuses = new Set(String(opt['retry-status'] || '').split(',').map(s => s.trim()).filter(Boolean));
  let pending = jobs.filter(j => opt.retry || !cache.has(j.ccn) || retryStatuses.has((cache.get(j.ccn) || {}).status));
  if (opt.limit) pending = pending.slice(0, num(opt.limit));

  const minScore = num(opt['min-score'], 0.55);
  const ptrTimeout = num(opt.timeout, 9000);
  const hasKey = !!process.env.OPENROUTER_API_KEY && !opt['no-llm'];

  log(`${jobs.length} hospitals in ${path.basename(inputPath)}` +
    (known.size ? ` (skipped ${rows.length - jobs.length} already in outreach.json)` : '') +
    `; ${pending.length} to process (cached: ${cache.size}).`);
  // Nothing new to crawl, but cached rows may still need phase 5.
  if (!pending.length) { await confirmPhase(); await adjudicatePhase(); await writeOut(); return; }
  if (!hasKey) log(opt['no-llm'] ? 'Model step disabled (--no-llm).' : 'OPENROUTER_API_KEY not set -- heuristic guesses only.');

  const result = new Map();            // ccn -> record
  const wikidataDomainsByCcn = new Map(); // ccn -> [domain], one free bulk lookup
  const searchDomainsByCcn = new Map(); // ccn -> [domain], filled by web search
  const llmDomainsByCcn = new Map();   // ccn -> [domain], filled by phase 3

  /* -- phase 1: free candidates (Wikidata + heuristic + seeded) ---------- */
  if (opt.wikidata && pending.length) {
    log('phase 1: fetching official hospital websites from Wikidata (one bulk query, no key)...');
    const wd = await fetchWikidata({ timeoutMs: num(opt['wikidata-timeout'], 180000) });
    if (wd.error) {
      log(`  wikidata failed: ${wd.error}`);
    } else {
      const map = wikidataCandidates(pending, wd.rows, {
        threshold: num(opt['wikidata-threshold'], 0.70)
      });
      let count = 0;
      for (const [ccn, picks] of map) {
        const domains = picks.map(p => p.domain).filter(Boolean);
        wikidataDomainsByCcn.set(ccn, domains);
        count += domains.length;
      }
      log(`  ${wd.rows.length} Wikidata rows -> ${count} candidates for ${map.size} hospitals`);
    }
  }

  const pairs = [];
  for (const j of pending) {
    const proposed = [];
    for (const d of (wikidataDomainsByCcn.get(j.ccn) || [])) proposed.push({ d, method: 'wikidata' });
    if (!opt['no-heuristics']) {
      for (const d of candidateDomains(j)) proposed.push({ d, method: 'heuristic' });
    }
    const seen = new Set();
    for (const p of proposed) {
      if (!p.d || seen.has(p.d)) continue;
      seen.add(p.d);
      pairs.push({ j, ...p });
    }
  }
  log(`phase 1: ${pairs.length} free-candidate /cms-hpt.txt checks for ${pending.length} hospitals...`);
  let p1hits = 0, n = 0;
  await pooled(pairs, {
    concurrency: num(opt.concurrency, 12),
    keyFn: p => p.d,
    onProgress: (done, total) => { if (++n % 200 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}  verified=${p1hits}   `); }
  }, async ({ j, d, method }) => {
    if (result.get(j.ccn) && result.get(j.ccn).status === 'verified') return;
    const v = await verifyDomain(d, j, minScore, ptrTimeout);
    if (v.ok) {
      const prev = result.get(j.ccn);
      if (!prev || v.matchScore > (prev.matchScore || 0)) {
        result.set(j.ccn, { ...j, status: 'verified', method, domain: v.domain, pointer_url: v.pointerUrl, mrf_url: v.mrfUrl, source_page_url: v.sourcePageUrl, matchScore: v.matchScore, matched_location_name: v.matchedLocationName, note: `${v.entryCount} entries in file` });
        if (!prev) p1hits++;
      }
    }
  });
  process.stdout.write('\n');

  /* -- phase 2: search-engine candidates (opt-in) ----------------------- */
  const afterHeuristics = pending.filter(j => !(result.get(j.ccn) && result.get(j.ccn).status === 'verified'));
  if (opt.search && afterHeuristics.length) {
    const provider = activeSearchProvider();
    if (!provider) {
      log('phase 2: search requested, but no configured provider has credentials.');
    } else {
      log(`phase 2: ${provider.name} searches for ${afterHeuristics.length} hospitals still missing after heuristics...`);
      let searched = 0, searchErrors = 0;
      await pooled(afterHeuristics, {
        concurrency: num(opt['search-concurrency'], 5),
        onProgress: (done, total) => process.stdout.write(`\r  ${done}/${total}  candidates=${searched} errors=${searchErrors}   `)
      }, async (j) => {
        const r = await searchHospitalDomains(j, {
          num: num(opt['search-results'], 8), timeoutMs: num(opt['search-timeout'], 30000)
        });
        if (r.error) { searchErrors++; return; }
        const domains = [...new Set((r.domains || []).filter(d => d && !isAggregator(d)))];
        if (domains.length) {
          searchDomainsByCcn.set(j.ccn, domains);
          searched += domains.length;
        }
      });
      process.stdout.write('\n');

      const spairs = [];
      for (const j of afterHeuristics) {
        for (const d of (searchDomainsByCcn.get(j.ccn) || [])) spairs.push({ j, d });
      }
      log(`phase 2: ${spairs.length} search-result /cms-hpt.txt checks...`);
      let searchHits = 0;
      await pooled(spairs, {
        concurrency: num(opt.concurrency, 12),
        keyFn: p => p.d,
        onProgress: (done, total) => process.stdout.write(`\r  ${done}/${total}  verified=${searchHits}   `)
      }, async ({ j, d }) => {
        if (result.get(j.ccn) && result.get(j.ccn).status === 'verified') return;
        const v = await verifyDomain(d, j, minScore, ptrTimeout);
        if (!v.ok) return;
        const prev = result.get(j.ccn);
        if (!prev || v.matchScore > (prev.matchScore || 0)) {
          result.set(j.ccn, { ...j, status: 'verified', method: `search:${provider.name}`, domain: v.domain, pointer_url: v.pointerUrl, mrf_url: v.mrfUrl, source_page_url: v.sourcePageUrl, matchScore: v.matchScore, matched_location_name: v.matchedLocationName, note: `${v.entryCount} entries in file` });
          if (!prev || prev.status !== 'verified') searchHits++;
        }
      });
      process.stdout.write('\n');
    }
  }

  /* -- phase 3: model-proposed domains --------------------------------- */
  const stillMissing = pending.filter(j => !(result.get(j.ccn) && result.get(j.ccn).status === 'verified'));
  if (hasKey && stillMissing.length) {
    const batchN = num(opt['llm-batch'], 8);
    const batches = [];
    for (let i = 0; i < stillMissing.length; i += batchN) batches.push(stillMissing.slice(i, i + batchN));
    log(`phase 3: model domains for ${stillMissing.length} hospitals in ${batches.length} batches...`);

    // A dropped batch is 8 hospitals silently answered "no domain", so a failure
    // is retried once and what still fails is reported rather than swallowed.
    const batchErrors = [];
    await pooled(batches, {
      concurrency: num(opt['llm-concurrency'], 3),
      onProgress: (done, total) => process.stdout.write(`\r  batch ${done}/${total}  errors=${batchErrors.length}   `)
    }, async (batch) => {
      const call = () => llmDomainCandidates(batch, {
        batchSize: batch.length, timeoutMs: num(opt['llm-timeout'], 90000), model: opt.model
      });
      let res = await call();
      if (res.error) res = await call();
      if (res.error) { batchErrors.push(res.error); return; }
      for (const [ccn, picks] of res.map) llmDomainsByCcn.set(ccn, picks.map(p => p.domain));
    });
    process.stdout.write('\n');
    const answered = [...llmDomainsByCcn.values()].reduce((a, v) => a + v.length, 0);
    log(`  model proposed ${answered} domains for ${llmDomainsByCcn.size}/${stillMissing.length} hospitals` +
      (batchErrors.length ? `; ${batchErrors.length} batches failed twice: ${batchErrors[0]}` : ''));

    const lpairs = [];
    for (const j of stillMissing) for (const d of (llmDomainsByCcn.get(j.ccn) || [])) if (!isAggregator(d)) lpairs.push({ j, d });
    log(`phase 3: ${lpairs.length} model-proposed /cms-hpt.txt checks...`);
    let p2hits = 0, m = 0;
    await pooled(lpairs, {
      concurrency: num(opt.concurrency, 12),
      keyFn: p => p.d,
      onProgress: (done, total) => { if (++m % 100 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}  verified=${p2hits}   `); }
    }, async ({ j, d }) => {
      if (result.get(j.ccn) && result.get(j.ccn).status === 'verified') return;
      const v = await verifyDomain(d, j, minScore, ptrTimeout);
      if (v.ok) {
        const prev = result.get(j.ccn);
        if (!prev || v.matchScore > (prev.matchScore || 0)) {
          result.set(j.ccn, { ...j, status: 'verified', method: 'llm', domain: v.domain, pointer_url: v.pointerUrl, mrf_url: v.mrfUrl, source_page_url: v.sourcePageUrl, matchScore: v.matchScore, matched_location_name: v.matchedLocationName, note: `${v.entryCount} entries in file` });
          if (!prev || prev.status !== 'verified') p2hits++;
        }
      }
    });
    process.stdout.write('\n');
  }

  /* -- phase 4: homepage clearly names the hospital ---------------------- */
  // Runs whether or not the model ran: a site we can identify is worth
  // recording even when no cms-hpt.txt was found on it.
  const noFile = pending.filter(j => !(result.get(j.ccn) && result.get(j.ccn).status === 'verified'));
  const probe = [];
  for (const j of noFile) {
    const cands = [...new Set([
      ...(searchDomainsByCcn.get(j.ccn) || []),
      ...(llmDomainsByCcn.get(j.ccn) || []),
      ...(wikidataDomainsByCcn.get(j.ccn) || []),
      ...(!opt['no-heuristics'] ? candidateDomains(j) : [])
    ])].slice(0, 5);
    for (const d of cands) probe.push({ j, d });
  }
  if (probe.length) {
    log(`phase 4: ${probe.length} homepage checks for ${noFile.length} hospitals with no file found...`);
    let p3hits = 0, k = 0;
    await pooled(probe, {
      concurrency: num(opt.concurrency, 12),
      keyFn: p => p.d,
      onProgress: (done, total) => { if (++k % 100 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}  site-found=${p3hits}   `); }
    }, async ({ j, d }) => {
      if (result.get(j.ccn)) return;
      const s = await siteMentions(d, j, ptrTimeout + 6000);
      if (s) { result.set(j.ccn, { ...j, status: 'site-found', method: 'homepage', domain: s.domain, pointer_url: '', mrf_url: '', source_page_url: '', matchScore: '', matched_location_name: '', note: `homepage: ${s.homepageTitle}` }); p3hits++; }
    });
    process.stdout.write('\n');
  }

  // Everything else this pass: status none.
  for (const j of pending) {
    if (!result.has(j.ccn)) result.set(j.ccn, { ...j, status: 'none', method: '', domain: '', pointer_url: '', mrf_url: '', source_page_url: '', matchScore: '', matched_location_name: '', note: '' });
    cache.set(j.ccn, { ...result.get(j.ccn), at: new Date().toISOString() });
  }
  await cache.save(true);
  await confirmPhase();
  await adjudicatePhase();
  await writeOut();

  /* -- phase 5: state corroboration on every name match ------------------ */
  async function confirmPhase() {
    const todo = Object.values(cache.data).filter(r => r.status === 'verified' && !r.confirm_conf);
    if (!todo.length) return;
    log(`phase 5: state-corroborating ${todo.length} name matches against the MRF header...`);
    let kept = 0, rejected = 0, c = 0;
    await pooled(todo, {
      concurrency: num(opt.concurrency, 14),
      keyFn: r => hostOf(r.mrf_url) || r.domain,
      onProgress: (done, total) => { if (++c % 25 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}  kept=${kept} rejected=${rejected}   `); }
    }, async (rec) => {
      const v = await confirmState(rec, rec, num(opt['probe-timeout'], 30000));
      const p = v.probe || {};
      cache.set(rec.ccn, {
        ...rec,
        status: v.ok ? 'verified' : 'unconfirmed',
        confirm_conf: v.conf || 'low',
        confirm_note: v.why,
        license_state: p.mrfLicenseState || '',
        mrf_hospital_name: p.mrfHospitalName || '',
        mrf_address: p.mrfAddress || '',
        mrf_last_updated: p.declaredLastUpdated || '',
        cms_version: p.cmsVersion || ''
      });
      if (v.ok) kept++; else rejected++;
    });
    await cache.save(true);
    process.stdout.write('\n');
    log(`  kept ${kept}, demoted ${rejected} to unconfirmed`);
  }

  /* -- phase 6: adjudicate weak name matches that only passed on state --- */
  /**
   * The state gate kills cross-state collisions but not same-system, same-state
   * ones: "Ochsner Lafayette General" scored 0.55 against "Ochsner Medical
   * Center - Kenner", a different hospital in the same system and state.
   * lib/adjudicate.js is already tuned for exactly this ("being part of the
   * same health system does NOT make two facilities the same hospital"), and
   * only an affirmative HIGH-confidence ruling is allowed to keep the row.
   */
  async function adjudicatePhase() {
    if (!hasKey || opt['no-adjudicate']) return;
    const floor = num(opt['adjudicate-below'], 0.85);
    const todo = Object.values(cache.data)
      .filter(r => r.status === 'verified' && !r.adjudicated && Number(r.matchScore) < floor);
    if (!todo.length) return;
    log(`phase 6: adjudicating ${todo.length} name matches scoring under ${floor}...`);
    let kept = 0, dropped = 0, c = 0;
    await pooled(todo, {
      concurrency: num(opt['llm-concurrency'], 3),
      onProgress: (done, total) => { if (++c % 10 === 0 || done === total) process.stdout.write(`\r  ${done}/${total}  kept=${kept} dropped=${dropped}   `); }
    }, async (rec) => {
      const verdict = await adjudicatePair(
        { name: rec.name, address: rec.address, city: rec.city, state: rec.state, zip: rec.zip },
        { locationName: rec.matched_location_name, domain: rec.domain },
        { mrfHospitalName: rec.mrf_hospital_name, mrfAddress: rec.mrf_address, mrfLicenseState: rec.license_state },
        { model: opt.model, timeoutMs: num(opt['llm-timeout'], 120000) }
      );
      const ok = isAccepted(verdict);
      cache.set(rec.ccn, {
        ...rec,
        adjudicated: true,
        status: ok ? 'verified' : 'unconfirmed',
        confirm_note: rec.confirm_note + ` | adjudicator: ${verdict && verdict.error ? verdict.error : (verdict ? `${verdict.match}/${verdict.confidence} - ${verdict.reason}` : 'no verdict')}`
      });
      if (ok) kept++; else dropped++;
    });
    await cache.save(true);
    process.stdout.write('\n');
    log(`  kept ${kept}, dropped ${dropped} as sibling/near-miss facilities`);
  }

  async function writeOut() {
    for (const r of Object.values(cache.data)) {
      r.resolved_domain = (r.status === 'verified' || r.status === 'site-found') ? (r.domain || '') : '';
    }
    const COLS = ['ccn', 'name', 'city', 'state', 'status', 'confirm_conf', 'method', 'domain', 'resolved_domain', 'matchScore',
      'license_state', 'mrf_last_updated', 'cms_version',
      'pointer_url', 'mrf_url', 'source_page_url', 'matched_location_name', 'confirm_note', 'note'];
    const all = Object.values(cache.data)
      .sort((a, b) => (a.status || '').localeCompare(b.status || '') || (a.state || '').localeCompare(b.state || '') || (a.name || '').localeCompare(b.name || ''));
    await fsp.writeFile(outPath, toCSV(all, COLS));

    const by = {}; const meth = {};
    for (const r of all) { by[r.status] = (by[r.status] || 0) + 1; if (r.status === 'verified') meth[r.method] = (meth[r.method] || 0) + 1; }
    log('');
    log(`results (${all.length} hospitals): ${JSON.stringify(by)}`);
    if (by.verified) log(`  verified by: ${JSON.stringify(meth)}  -- these have a working cms-hpt.txt that names the hospital`);
    if (by['site-found']) log(`  site-found: homepage identified but no cms-hpt.txt -- run: node scripts/hpt/run.js recover --llm`);
    log(`-> ${path.relative(ROOT_DIR, outPath)}`);
    if (all.some(r => r.resolved_domain)) log(`import domains with: node scripts/hpt/run.js gaps --import=${path.relative(ROOT_DIR, outPath)}`);
  }
}

main().catch(e => { console.error('\nERROR:', (e && e.message) || e); process.exitCode = 1; });
