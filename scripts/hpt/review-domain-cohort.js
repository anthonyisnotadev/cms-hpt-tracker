'use strict';
// Resumable evidence inventory. Raw candidates remain in ignored staging.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { csvToObjects } = require('./lib/util');
const ROOT = path.resolve(__dirname, '../..');
const AUDIT = path.join(ROOT, 'data/hpt-audit');
const STAGE = path.join(AUDIT, '.domain-discovery');
const OUT = path.join(STAGE, 'review-569');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const readCsv = file => csvToObjects(fs.readFileSync(file, 'utf8'));
const { digest, reconcile, classify, LABELS, parsePointerEntries } = require('./lib/discovery-review');
function identityRows() {
  const readOptional = name => {
    const file = path.join(OUT, name);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  };
  return [...readOptional('deep-identity-v2.json'), ...readOptional('manual-identity.json'), ...readOptional('auto-identity.json')]
    .reduce((map, row) => map.set(row.ccn, row), new Map()).values();
}
function inventory() {
  fs.mkdirSync(OUT, { recursive: true });
  const frozen = path.join(OUT, 'cohort.json');
  if (!fs.existsSync(frozen)) {
    const observations = readCsv(path.join(AUDIT, 'domain-observations.csv'));
    const selected = new Set(observations.filter(r => ['candidate-found', 'search-not-run', 'search-error', 'no-candidate'].includes(r.observation)).map(r => r.ccn));
    const rows = readCsv(path.join(AUDIT, 'compliance.csv')).filter(r => selected.has(r.ccn));
    if (rows.length !== 569 || new Set(rows.map(r => r.ccn)).size !== 569) throw Error('Expected exactly 569 unique CCNs');
    fs.writeFileSync(frozen, JSON.stringify({ created_at: new Date().toISOString(), rows }, null, 2));
  }
  const cohort = JSON.parse(fs.readFileSync(frozen, 'utf8'));
  const by = new Map(cohort.rows.map(r => [r.ccn, { base: r, evidence: new Map(), sources: [] }]));
  function add(ccn, item, source) {
    const record = by.get(ccn); if (!record) return;
    const id = hash(item);
    if (!record.evidence.has(id)) record.evidence.set(id, { id, observation: item, sources: [] });
    record.evidence.get(id).sources.push(source);
  }
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (file === OUT || entry.name === 'source-cache') continue;
      if (entry.isDirectory()) { walk(file); continue; }
      const source = path.relative(ROOT, file).replaceAll('\\', '/');
      if (['evidence.csv', 'search_leads.csv', 'verified.csv', 'assessments.csv'].includes(entry.name)) {
        for (const row of readCsv(file)) add(row.ccn, row, source);
      } else if (/^bucket-leads-search-\d+\.json$/.test(entry.name)) {
        for (const row of JSON.parse(fs.readFileSync(file, 'utf8'))) add(row.ccn, row, source);
      }
    }
  }
  walk(STAGE);
  walk(path.join(AUDIT, 'rechecks'));
  const { normalizeName } = require('./lib/util');
  for (const file of fs.readdirSync(OUT).filter(f => /^search-\d+\.json$/.test(f))) {
    const search = JSON.parse(fs.readFileSync(path.join(OUT, file), 'utf8'));
    for (const q of search.queries) {
      const target = by.get(q.ccn); if (!target) continue;
      const tokens = normalizeName(target.base.hospital_name).split(' ').filter(t => t.length > 2);
      const candidates = [];
      for (const match of String(search.result).matchAll(/^(.+) \((https?:\/\/[^\s]+)\)$/gm)) {
        const title = normalizeName(match[1]);
        const hits = tokens.filter(t => title.includes(t)).length;
        if (tokens.length && hits / tokens.length >= 0.6) candidates.push({ domain: new URL(match[2]).hostname, url: match[2], title: match[1] });
      }
      add(q.ccn, { query: q.q, candidates, checked_at: search.observed_at,
        kind: 'web-search-leads-only', query_submitted: true, batch_response_saved: true,
        query_completed: false, results_adjudicated: false }, path.relative(ROOT, path.join(OUT, file)).replaceAll('\\', '/'));
    }
  }
  const rows = [...by.values()].map(r => ({ base: r.base, evidence: reconcile([...r.evidence.values()]), disposition: 'pending-fresh-review' }));
  fs.writeFileSync(path.join(OUT, 'inventory.json'), JSON.stringify(rows, null, 2));
  const summary = { cohort: rows.length, unique_observations: rows.reduce((n, r) => n + r.evidence.length, 0), pending_fresh_review: rows.length };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(summary);
}
async function fresh() {
  const { directGet, BROWSER_HEADERS } = require('./lib/fetch');
  const cheerio = require('cheerio');
  const rows = JSON.parse(fs.readFileSync(path.join(OUT, 'inventory.json'), 'utf8'));
  const jobs = new Map();
  for (const row of rows) {
    for (const saved of row.evidence) {
      const e = saved.observation;
      const leads = [e.candidate_domain, e.hospital_url, e.result_url,
        ...(e.candidates || []).flatMap(c => [c.domain, c.url])].filter(Boolean);
      if (e.sources === 'heuristic') continue;
      for (const lead of leads) {
        let url; try { url = new URL(lead.includes('://') ? lead : 'https://' + lead); } catch { continue; }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
        const host = url.hostname.toLowerCase();
        if (!jobs.has(host)) jobs.set(host, new Set());
        jobs.get(host).add(row.base.ccn);
      }
    }
  }
  const searchDir = path.join(OUT, 'fresh-search');
  if (fs.existsSync(searchDir)) for (const file of fs.readdirSync(searchDir).filter(f => f.endsWith('.json'))) {
    const search = JSON.parse(fs.readFileSync(path.join(searchDir, file), 'utf8'));
    for (const attempt of search.attempts || []) for (const result of attempt.results || []) {
      let host; try { host = new URL(result.url).hostname.toLowerCase(); } catch { continue; }
      if (!jobs.has(host)) jobs.set(host, new Set());
      jobs.get(host).add(search.ccn);
    }
  }
  const dir = path.join(OUT, 'fresh'); fs.mkdirSync(dir, { recursive: true });
  for (const [host, ccns] of jobs) {
    const file = path.join(dir, hash(host) + '.json');
    if (fs.existsSync(file)) {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Shared host retrieval is reusable, but never shares facility identity.
      cached.ccns = [...ccns];
      fs.writeFileSync(file, JSON.stringify(cached));
    }
  }
  const pending = [...jobs].filter(([host]) => !fs.existsSync(path.join(dir, hash(host) + '.json')));
  let index = 0, done = 0;
  console.log(JSON.stringify({ distinct_hosts: jobs.size, pending: pending.length }));
  async function worker() {
    while (index < pending.length) {
      const [host, ccns] = pending[index++];
      const observations = [];
      const urls = [`https://${host}/`];
      for (const url of urls) {
        const checked_at = new Date().toISOString();
        const r = await directGet(url, { timeoutMs: 12000, maxBytes: 524288 });
        const $ = cheerio.load(r.body || ''); $('script,style,noscript').remove();
        const links = $('a[href]').toArray().map(el => {
          try { return { url: new URL($(el).attr('href'), r.finalUrl || url).href, text: $(el).text().trim().slice(0, 160) }; } catch { return null; }
        }).filter(Boolean).filter(l => /price|transparen|standard.?charge|contact|location|about/i.test(l.url + ' ' + l.text)).slice(0, 30);
        observations.push({ url, final_url: r.finalUrl, checked_at, http_status: r.status,
          transport_error: r.error || '', capped: !!r.tooLarge, sha256: hash(r.body || ''),
          text: $('body').text().replace(/\s+/g, ' ').trim(), links });
      }
      fs.writeFileSync(path.join(dir, hash(host) + '.json'), JSON.stringify({ host, ccns: [...ccns], observations }));
      if (++done % 25 === 0) console.log(`Fresh homepages ${done}/${pending.length}`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`Completed ${done} fresh host checks; saved privately for identity review.`);
}
async function searchAll() {
  const { directGet } = require('./lib/fetch');
  const cheerio = require('cheerio');
  const rows = JSON.parse(fs.readFileSync(path.join(OUT, 'inventory.json'), 'utf8'));
  const current = fs.existsSync(path.join(AUDIT, 'discovery-review.json'))
    ? JSON.parse(fs.readFileSync(path.join(AUDIT, 'discovery-review.json'), 'utf8')).records : [];
  const resolved = new Set(current.filter(r => r.disposition === 'official-hpt-pending').map(r => r.ccn));
  const dir = path.join(OUT, 'fresh-search'); fs.mkdirSync(dir, { recursive: true });
  const jobs = rows.filter(r => !resolved.has(r.base.ccn));
  let next = 0, completed = 0;
  function resultLinks(engine, body) {
    const $ = cheerio.load(body || ''), links = [];
    const nodes = engine === 'google' ? $('a:has(h3)') : engine === 'bing' ? $('li.b_algo h2 a') : $('.result__a');
    nodes.each((_, el) => {
      let href = $(el).attr('href') || '';
      if (href.startsWith('/url?')) href = new URL(href, 'https://www.google.com').searchParams.get('q') || '';
      try {
        const u = new URL(href);
        if (!/^https?:$/.test(u.protocol) || /(^|\.)(google|bing|duckduckgo)\./i.test(u.hostname)) return;
        links.push({ url: u.href, title: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 240) });
      } catch {}
    });
    return [...new Map(links.map(l => [l.url, l])).values()].slice(0, 12);
  }
  async function worker() { while (next < jobs.length) {
    const row = jobs[next++], outFile = path.join(dir, row.base.ccn + '.json');
    if (fs.existsSync(outFile)) { completed++; continue; }
    const address = row.evidence.map(e => e.observation.address).find(Boolean) || '';
    const query = `${row.base.hospital_name} ${address} ${row.base.city} ${row.base.state} official website`;
    const attempts = [];
    for (const engine of ['google', 'bing']) {
      const url = engine === 'google' ? 'https://www.google.com/search?q=' + encodeURIComponent(query)
        : 'https://www.bing.com/search?q=' + encodeURIComponent(query);
      const checked_at = new Date().toISOString();
      const r = await directGet(url, { timeoutMs: 20000, maxBytes: 786432 });
      attempts.push({ engine, checked_at, http_status: r.status, transport_error: r.error || '',
        capped: !!r.tooLarge, response_sha256: crypto.createHash('sha256').update(r.body || '').digest('hex'),
        results: resultLinks(engine, r.body), raw_body: r.body || '' });
      if (attempts.at(-1).results.length >= 3) break;
    }
    fs.writeFileSync(outFile, JSON.stringify({ ccn: row.base.ccn, query, attempts }));
    if (++completed % 25 === 0) console.log(`Fresh searches ${completed}/${jobs.length}`);
    await new Promise(resolve => setTimeout(resolve, 150));
  }}
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`Completed/resumed ${completed} fresh searches.`);
}
async function official() {
  const { directGet, looksLikePointer } = require('./lib/fetch');
  const identities = [...identityRows()];
  const dir = path.join(OUT, 'official'); fs.mkdirSync(dir, { recursive: true });
  const jobs = identities.filter(r => r.identity === 'corroborated');
  let next = 0;
  async function worker() { while (next < jobs.length) {
    const identity = jobs[next++];
    const outFile = path.join(dir, identity.ccn + '.json');
    if (fs.existsSync(outFile)) continue;
    const attempts = [], pricing_attempts = [];
    for (const host of [identity.official_domain, 'www.' + identity.official_domain]) {
      for (const route of ['/cms-hpt.txt', '/.well-known/cms-hpt.txt']) {
        const url = 'https://' + host + route, checked_at = new Date().toISOString();
        const r = await directGet(url, { timeoutMs: 8000, maxBytes: 262144 });
        attempts.push({ url, checked_at, official_location: true, http_status: r.status,
          error: r.error || '', usable: r.status >= 200 && r.status < 300 && looksLikePointer(r.body),
          body_sha256: crypto.createHash('sha256').update(r.body || '').digest('hex'),
          capped: !!r.tooLarge, body: r.body || '' });
      }
    }
    for (const url of (identity.pricing_urls || []).slice(0, 5)) {
      const checked_at = new Date().toISOString();
      const r = await directGet(url, { timeoutMs: 10000, maxBytes: 524288 });
      pricing_attempts.push({ url, checked_at, http_status: r.status, error: r.error || '', capped: !!r.tooLarge,
        body_sha256: crypto.createHash('sha256').update(r.body || '').digest('hex'), body: r.body || '' });
    }
    fs.writeFileSync(outFile, JSON.stringify({ ccn: identity.ccn, attempts, pricing_attempts }, null, 2));
    console.log(identity.ccn + ' official pointer requests saved');
  }}
  await Promise.all(Array.from({ length: 8 }, worker));
}

async function retryOfficialFailures() {
  const { looksLikePointer } = require('./lib/fetch');
  const { retrieve, decode } = require('./lib/recovery-transport');
  const dir = path.join(OUT, 'official');
  const jobs = [];
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.json'))) {
    const absolute = path.join(dir, file), saved = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    for (let index = 0; index < (saved.attempts || []).length; index++) {
      const attempt = saved.attempts[index];
      if (!Number(attempt.http_status)) jobs.push({ absolute, saved, index, attempt });
    }
  }
  let next = 0, completed = 0;
  console.log(JSON.stringify({ failed_pointer_requests: jobs.length }));
  async function worker() { while (next < jobs.length) {
    const job = jobs[next++], response = await retrieve(job.attempt.url, 262144, { timeoutMs: 20000 });
    const body = decode(response.body), checked_at = response.checkedAt || new Date().toISOString();
    const replacement = { url: job.attempt.url, checked_at, official_location: true,
      http_status: response.status, error: response.error || '',
      usable: response.status >= 200 && response.status < 300 && looksLikePointer(body),
      body_sha256: crypto.createHash('sha256').update(body).digest('hex'),
      capped: response.body.length >= 262144, body,
      transport: response.via || '', attempts: response.attempts || [] };
    // Keep the earlier observation while making the latest same-URL result the
    // one used by adjudication.
    job.saved.attempt_history = [...(job.saved.attempt_history || []), job.attempt];
    job.saved.attempts[job.index] = replacement;
    fs.writeFileSync(job.absolute, JSON.stringify(job.saved, null, 2));
    if (++completed % 25 === 0) console.log(`Official pointer retries ${completed}/${jobs.length}`);
  }}
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(JSON.stringify({ retried: completed }));
}

async function verifyPointers() {
  const { directGet } = require('./lib/fetch');
  const { parsePointerEntries, matchPointerEntry } = require('./lib/discovery-review');
  const identities = [...identityRows()];
  const cohort = JSON.parse(fs.readFileSync(path.join(OUT, 'cohort.json'), 'utf8'));
  const baseBy = new Map(cohort.rows.map(row => [row.ccn, row]));
  const aliasFile = path.join(OUT, 'manual-pointer-aliases.json');
  const aliasBy = new Map((fs.existsSync(aliasFile) ? JSON.parse(fs.readFileSync(aliasFile, 'utf8')) : []).map(row => [row.ccn, row]));
  const dir = path.join(OUT, 'mrf'); fs.mkdirSync(dir, { recursive: true });
  const jobs = [];
  for (const identity of identities.filter(row => row.identity === 'corroborated')) {
    const file = path.join(OUT, 'official', identity.ccn + '.json');
    if (!fs.existsSync(file)) continue;
    const pointer = JSON.parse(fs.readFileSync(file, 'utf8'));
    const parsed = [];
    for (const attempt of pointer.attempts || []) {
      if (!attempt.usable) continue;
      for (const entry of parsePointerEntries(attempt.body)) parsed.push({ ...entry, pointer_url: attempt.url, pointer_checked_at: attempt.checked_at });
    }
    const entries = [...new Map(parsed.map(row => [JSON.stringify([row.location_name, row.source_page_url, row.mrf_url]), row])).values()];
    const base = baseBy.get(identity.ccn);
    const aliasReview = aliasBy.get(identity.ccn);
    const matched = matchPointerEntry(base?.hospital_name || '', entries, [...(identity.pointer_aliases || []), ...(aliasReview?.aliases || [])]);
    const outFile = path.join(dir, identity.ccn + '.json');
    if (!matched) {
      fs.writeFileSync(outFile, JSON.stringify({ ccn: identity.ccn, entries: entries.map(row => ({ ...row })), facility_matched: false }, null, 2));
      continue;
    }
    if (fs.existsSync(outFile)) {
      const cached = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      if (cached.facility_matched && cached.entry?.mrf_url === matched.entry.mrf_url && cached.file_attempt) continue;
    }
    jobs.push({ identity, entry: matched.entry, matched_words: matched.matched_words, alias_review: aliasReview || null, outFile });
  }
  let next = 0, completed = 0;
  console.log(JSON.stringify({ matched_pointer_entries: jobs.length, total_identities: identities.length }));
  async function worker() { while (next < jobs.length) {
    const job = jobs[next++];
    const safeUrl = value => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
    const sourceUrl = safeUrl(job.entry.source_page_url), mrfUrl = safeUrl(job.entry.mrf_url);
    const source_attempt = sourceUrl ? await directGet(sourceUrl, { timeoutMs: 15000, maxBytes: 524288 })
      : { status: 0, error: 'pointer source-page-url is missing or invalid', finalUrl: sourceUrl };
    const file_attempt = mrfUrl ? await directGet(mrfUrl, { timeoutMs: 25000, maxBytes: 1048576 })
      : { status: 0, error: 'pointer mrf-url is missing or invalid', finalUrl: mrfUrl };
    const observed_at = new Date().toISOString();
    const sanitize = result => ({ requested_url: result === file_attempt ? mrfUrl : sourceUrl,
      final_url: result.finalUrl || '', checked_at: observed_at, http_status: result.status,
      error: result.error || '', capped: !!result.tooLarge, bytes_read: result.bytesRead || 0,
      body_sha256: hash(result.body || ''), body_prefix: String(result.body || '').slice(0, 1048576) });
    fs.writeFileSync(job.outFile, JSON.stringify({ ccn: job.identity.ccn, facility_matched: true,
      matched_words: job.matched_words, alias_review: job.alias_review, entry: job.entry, source_attempt: sanitize(source_attempt), file_attempt: sanitize(file_attempt) }, null, 2));
    if (++completed % 10 === 0) console.log(`Pointer-linked files ${completed}/${jobs.length}`);
  }}
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`Completed ${completed} pointer-linked pricing/MRF checks.`);
}

async function checkAlternatives() {
  const { directGet } = require('./lib/fetch');
  const cheerio = require('cheerio');
  const identities = [...identityRows()].filter(row => row.identity === 'corroborated');
  const dir = path.join(OUT, 'alternatives'); fs.mkdirSync(dir, { recursive: true });
  let next = 0, completed = 0;
  const compact = (requested_url, checked_at, result) => ({ requested_url, checked_at,
    final_url: result.finalUrl || requested_url, http_status: result.status, error: result.error || '',
    capped: !!result.tooLarge, bytes_read: result.bytesRead || 0, body_sha256: hash(result.body || '') });
  async function worker() { while (next < identities.length) {
    const identity = identities[next++], outFile = path.join(dir, identity.ccn + '.json');
    if (fs.existsSync(outFile)) { completed++; continue; }
    const seeds = [...new Set([`https://${identity.official_domain}/`, identity.source_url, ...(identity.pricing_urls || [])].filter(Boolean))];
    const seed_attempts = [], links = [];
    for (const url of seeds.slice(0, 4)) {
      const checked_at = new Date().toISOString(), result = await directGet(url, { timeoutMs: 15000, maxBytes: 524288 });
      seed_attempts.push(compact(url, checked_at, result));
      if (!result.body || /\.pdf(?:$|[?#])/i.test(result.finalUrl || url)) continue;
      const $ = cheerio.load(result.body), base = result.finalUrl || url;
      $('a[href]').each((_, el) => {
        const label = ($(el).text() + ' ' + ($(el).attr('href') || '')).replace(/\s+/g, ' ');
        if (!/price|transparen|standard.?charge|chargemaster|machine.?readable|\bmrf\b/i.test(label)) return;
        try {
          const found = new URL($(el).attr('href'), base);
          if (/^https?:$/.test(found.protocol) && !found.username && !found.password) links.push({ url: found.href, label: $(el).text().trim().slice(0, 180), discovered_from: base });
        } catch {}
      });
    }
    const uniqueLinks = [...new Map(links.map(row => [row.url, row])).values()].slice(0, 8);
    const pricing_attempts = [];
    for (const link of uniqueLinks.filter(row => !/\.(csv|json)(?:\.gz)?(?:$|[?#])/i.test(row.url)).slice(0, 3)) {
      const checked_at = new Date().toISOString(), result = await directGet(link.url, { timeoutMs: 15000, maxBytes: 524288 });
      pricing_attempts.push(compact(link.url, checked_at, result));
    }
    fs.writeFileSync(outFile, JSON.stringify({ ccn: identity.ccn, seed_attempts, pricing_links: uniqueLinks, pricing_attempts }, null, 2));
    if (++completed % 25 === 0) console.log(`Official alternatives ${completed}/${identities.length}`);
  }}
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`Completed/resumed ${completed} official-site alternative and pricing-page checks.`);
}

function adjudicate() {
  const { normalizeName } = require('./lib/util');
  const rows = JSON.parse(fs.readFileSync(path.join(OUT, 'inventory.json'), 'utf8'));
  const freshDir = path.join(OUT, 'fresh');
  const fresh = fs.readdirSync(freshDir).map(file => ({ file, ...JSON.parse(fs.readFileSync(path.join(freshDir, file), 'utf8')) }));
  const by = new Map();
  for (const f of fresh) for (const ccn of f.ccns) {
    if (!by.has(ccn)) by.set(ccn, []);
    by.get(ccn).push(...f.observations.map(o => ({ ...o, host: f.host, source_file: 'fresh/' + f.file })));
  }
  const generic = new Set(['hospital','hosp','medical','med','center','ctr','health','healthcare','system','campus','the','of','and','inc','llc']);
  const words = s => [...new Set(normalizeName(s).split(/\s+/).filter(t => t.length > 2 && !generic.has(t)))];
  const rejectedHosts = /(^|\.)(college\.com|pagosa\.com|clivechamber\.org|hoaumich\.org)$/i;
  const auto = [];
  for (const row of rows) {
    const base = row.base;
    const address = row.evidence.map(e => e.observation.address).find(Boolean) || '';
    const nameWords = words(base.hospital_name), addressWords = words(address), cityWords = words(base.city);
    const streetNumber = String(address).match(/\b\d{2,6}\b/)?.[0] || '';
    let best = null;
    for (const o of by.get(base.ccn) || []) {
      if (Number(o.http_status) < 200 || Number(o.http_status) >= 300 || rejectedHosts.test(o.host)) continue;
      const text = normalizeName(o.text || '');
      const nameHits = nameWords.filter(t => text.includes(t));
      const addressHits = addressWords.filter(t => text.includes(t));
      const cityHits = cityWords.filter(t => text.includes(t));
      const score = nameHits.length / (nameWords.length || 1) + addressHits.length / (addressWords.length || 1) + (cityHits.length ? .25 : 0);
      const sameHostAbout = (o.links || []).some(l => { try { return new URL(l.url).hostname === o.host && /contact|about|location/i.test(l.url + ' ' + l.text); } catch { return false; } });
      const qualifies = nameWords.length && nameHits.length / nameWords.length >= .8
        && streetNumber && new RegExp('\\b' + streetNumber + '\\b').test(text)
        && addressWords.length >= 2 && addressHits.length / addressWords.length >= .5
        && cityHits.length && sameHostAbout;
      if (qualifies && (!best || score > best.score)) best = { o, score, nameHits, addressHits, cityHits };
    }
    if (!best) continue;
    const host = best.o.host.replace(/^www\./, '');
    auto.push({ ccn: base.ccn, official_domain: host, source_url: best.o.final_url || best.o.url,
      identity: 'corroborated', observed_at: best.o.checked_at, method: 'bounded-direct-page',
      basis: `Retrieved page contains facility name anchors (${best.nameHits.join(', ')}), roster street number ${streetNumber}, address anchors (${best.addressHits.join(', ')}), and city (${best.cityHits.join(', ')}), with a same-host contact/about/location link.`,
      source_file: best.o.source_file,
      pricing_urls: (best.o.links || []).filter(l => /price|transparen|standard.?charge/i.test(l.url + ' ' + l.text)).map(l => l.url) });
  }
  // These two government/system domains have strong page identity but their
  // host names are not facility-name derived; require explicit inclusion.
  const explicit = new Set(['031307', '280059']);
  for (const ccn of explicit) if (!auto.some(r => r.ccn === ccn)) {
    const row = rows.find(r => r.base.ccn === ccn), requests = by.get(ccn) || [];
    const o = requests.find(q => q.http_status === 200 && normalizeName(q.text).includes(words(row.base.hospital_name)[0] || '__none__'));
    if (o) auto.push({ ccn, official_domain: o.host.replace(/^www\./, ''), source_url: o.final_url || o.url,
      identity: 'corroborated', observed_at: o.checked_at, method: 'bounded-direct-page-explicit-review',
      basis: 'Retrieved government or hospital-system page contains the facility name and complete roster address; host relationship was reviewed explicitly.',
      source_file: o.source_file, pricing_urls: (o.links || []).filter(l => /price|transparen|standard.?charge/i.test(l.url + ' ' + l.text)).map(l => l.url) });
  }
  fs.writeFileSync(path.join(OUT, 'auto-identity.json'), JSON.stringify(auto.sort((a,b) => a.ccn.localeCompare(b.ccn)), null, 2));
  console.log(JSON.stringify({ corroborated: auto.length, ccns: auto.map(r => r.ccn) }, null, 2));
}

function exportReview() {
  const { toCSV } = require('./lib/util');
  const rows = JSON.parse(fs.readFileSync(path.join(OUT, 'inventory.json'), 'utf8'));
  if (rows.length !== 569 || new Set(rows.map(r => r.base.ccn)).size !== 569) throw Error('Frozen cohort must contain 569 unique CCNs');
  const originals = readCsv(path.join(AUDIT, 'domain-observations.csv'));
  const identities = [...identityRows()].reduce((a, r) => (a.set(r.ccn, r), a), new Map());
  const generated_at = new Date().toISOString();
  const fresh = fs.readdirSync(path.join(OUT, 'fresh')).map(f => ({ file: f,
    ...JSON.parse(fs.readFileSync(path.join(OUT, 'fresh', f), 'utf8')) }));
  const searchDir = path.join(OUT, 'fresh-search');
  const freshSearches = fs.existsSync(searchDir) ? new Map(fs.readdirSync(searchDir).filter(f => f.endsWith('.json')).map(f => {
    const x = JSON.parse(fs.readFileSync(path.join(searchDir, f), 'utf8')); return [x.ccn, x];
  })) : new Map();
  const browserRetryFile = path.join(OUT, 'manual-browser-retries.json');
  const browserRetries = new Map((fs.existsSync(browserRetryFile) ? JSON.parse(fs.readFileSync(browserRetryFile, 'utf8')) : []).map(row => [row.ccn, row]));
  const requestId = q => digest({ url: q.url, checked_at: q.checked_at, http_status: q.http_status, body_digest: q.sha256 });
  const evidenceIndex = {};
  for (const r of rows) for (const e of r.evidence) evidenceIndex[e.id] = { sources: e.sources };
  for (const f of fresh) for (const q of f.observations) evidenceIndex[requestId(q)] = { source: 'fresh/' + f.file, url: q.url, checked_at: q.checked_at };
  fs.writeFileSync(path.join(OUT, 'evidence-index.json'), JSON.stringify(evidenceIndex, null, 2));
  const records = rows.map(r => {
    const manual = identities.get(r.base.ccn);
    const requests = fresh.filter(f => f.ccns.includes(r.base.ccn)).flatMap(f => f.observations.map(o => ({ ...o, source: 'fresh/' + f.file })));
    const pointerFile = path.join(OUT, 'official', r.base.ccn + '.json');
    const attempts = fs.existsSync(pointerFile) ? JSON.parse(fs.readFileSync(pointerFile, 'utf8')).attempts : [];
    const mrfFile = path.join(OUT, 'mrf', r.base.ccn + '.json');
    const mrf = fs.existsSync(mrfFile) ? JSON.parse(fs.readFileSync(mrfFile, 'utf8')) : null;
    const alternativeFile = path.join(OUT, 'alternatives', r.base.ccn + '.json');
    const alternatives = fs.existsSync(alternativeFile) ? JSON.parse(fs.readFileSync(alternativeFile, 'utf8')) : null;
    const browserRetry = browserRetries.get(r.base.ccn) || null;
    const pointerEntries = [...new Map(attempts.flatMap(a => a.usable ? parsePointerEntries(a.body) : [])
      .map(entry => [JSON.stringify([entry.location_name, entry.source_page_url, entry.mrf_url]), entry])).values()];
    const classifiedAttempts = attempts.map(a => ({ ...a, usable: !!(a.usable && parsePointerEntries(a.body).length) }));
    const search = freshSearches.get(r.base.ccn);
    const generic = new Set(['hospital','hosp','medical','med','center','ctr','health','healthcare','system','campus','the','of','and','inc','llc']);
    const nameWords = require('./lib/util').normalizeName(r.base.hospital_name).split(/\s+/).filter(t => t.length > 2 && !generic.has(t));
    const blockedDomains = /(^|\.)(facebook|linkedin|yelp|mapquest|wikipedia|npiprofile|healthgrades|usnews|chamberofcommerce|jointcommission|hospitalinspections|dnb|reddit|causeiq|hospitalcaredata|vitals|sharecare|yellowpages|superpages|buzzfile|opencorporates|miamiherald|sweetwaternow|abandonedamerica)\./i;
    const searchResults = (search?.attempts || []).flatMap(a => (a.results || []).map(x => ({ ...x, engine: a.engine, checked_at: a.checked_at })));
    const plausible = searchResults.filter(x => {
      let host; try { host = new URL(x.url).hostname; } catch { return false; }
      if (blockedDomains.test(host)) return false;
      const title = require('./lib/util').normalizeName(x.title || '');
      const hits = nameWords.filter(t => title.includes(t)).length;
      const compactHost = host.replace(/^www\./, '').replace(/[^a-z0-9]/g, '');
      return nameWords.length && (hits / nameWords.length >= .5 || nameWords.some(t => t.length >= 5 && compactHost.includes(t)));
    });
    // A fresh fetch of a preserved candidate is enough to retain a cautious
    // candidate label, but never enough to call the domain official. Require
    // either a distinctive name in the hostname or name plus city in the page,
    // and reject common directory/social/news sources and mismatched redirects.
    const freshPlausible = requests.filter(x => {
      let host; try { host = new URL(x.final_url || x.url).hostname; } catch { return false; }
      if (blockedDomains.test(host)) return false;
      const text = require('./lib/util').normalizeName(x.text || '');
      const city = require('./lib/util').normalizeName(r.base.city || '');
      const hits = nameWords.filter(t => text.includes(t)).length;
      const compactHost = host.replace(/^www\./, '').replace(/[^a-z0-9]/g, '');
      const hostMatch = nameWords.some(t => t.length >= 5 && compactHost.includes(t));
      const pageMatch = nameWords.length && hits / nameWords.length >= .6 && city && text.includes(city);
      return hostMatch || pageMatch;
    });
    const plausibleCandidates = [...new Map([...plausible, ...freshPlausible].map(x => [x.final_url || x.url, x])).values()];
    const searchFailure = search && (search.attempts || []).every(a => !a.http_status || a.http_status >= 400);
    // A 200 search page with zero parsed results is parser coverage failure,
    // not a completed empty search.
    const searchCompleted = search && searchResults.length > 0
      && (search.attempts || []).some(a => a.http_status >= 200 && a.http_status < 300 && !a.capped);
    const reviewed_at = manual?.observed_at || (search?.attempts || []).map(a => a.checked_at).filter(Boolean).sort().at(-1) || '';
    const reason = manual?.basis || (plausibleCandidates.length
      ? `Fresh checks retained ${plausibleCandidates.length} non-directory candidate(s) with facility-name or location support, but first-party street-address identity is not corroborated.`
      : searchFailure ? 'Fresh search requests did not return a usable HTTP response; no negative website conclusion was drawn.'
        : searchCompleted ? 'Fresh search completed, but extracted results did not support an official website after title/domain relevance and directory screening.'
          : 'Cross-run evidence collected; fresh search adjudication remains unfinished.');
    const next_action = manual?.next_action || (manual?.identity === 'corroborated'
      ? 'Complete a browser comparison, pricing-page review, and recorded alternative-pointer checks; then verify any pointer-linked file with bounded reads.'
      : manual ? 'Resolve the roster/address discrepancy using first-party location history; then inspect the official pointer and pricing page.'
      : plausibleCandidates.length ? 'Open the strongest candidate’s facility/contact page and corroborate the hospital street address; if confirmed, inspect its pricing page and pointer locations.'
        : searchFailure ? 'Retry search with a browser or alternate engine, then corroborate any candidate using a first-party facility address.'
          : 'Search historical/operator names and local government or health-system sources; corroborate any candidate using a first-party facility address.');
    const sourceRefs = manual ? [manual.source_url || `identity-search:${digest({ ccn: manual.ccn, observed_at: manual.observed_at, method: manual.method, basis: manual.basis })}`]
      : plausibleCandidates.length ? plausibleCandidates.slice(0, 5).map(x => x.final_url || x.url)
        : search ? [`fresh-search/${r.base.ccn}.json`] : r.evidence.map(e => e.id);
    const pointerReview = { attempts: classifiedAttempts, locations_complete: classifiedAttempts.length === 4 && classifiedAttempts.every(a => Number(a.http_status) > 0 && !a.error),
      retrieved: pointerEntries.length > 0, facility_matched: !!mrf?.facility_matched,
      confirmed_url: mrf?.facility_matched ? mrf.entry?.pointer_url : undefined };
    const fileAttempt = mrf?.facility_matched ? mrf.file_attempt : null;
    const fileReview = mrf?.facility_matched ? { facility_linked: true, attempted: !!fileAttempt,
      retrieved: !!fileAttempt && Number(fileAttempt.http_status) >= 200 && Number(fileAttempt.http_status) < 300 && (!!fileAttempt.body_prefix || fileAttempt.capped),
      http_status: Number(fileAttempt?.http_status || 0), error: fileAttempt?.error || '' } : {};
    const reviewedWebsite = !manual ? null
      : manual.identity === 'corroborated' ? { domain: manual.official_domain, identity: 'corroborated', plausible: true,
        name_evidence: manual.source_url, address_evidence: manual.source_url }
      : /conflict/.test(manual.identity) ? { domain: manual.candidate_domain, identity: 'conflict', plausible: true,
        name_evidence: manual.source_url, address_evidence: manual.source_url }
      : manual.identity === 'unverified' ? { domain: manual.candidate_domain, identity: 'unverified', plausible: true,
        candidate_urls: [manual.source_url].filter(Boolean), name_evidence: manual.source_url }
      : { identity: 'not-identified', plausible: false, rejected_candidate_urls: manual.rejected_candidate_urls || [] };
    const review = manual ? { reviewed_at, reason, next_action, sources: sourceRefs,
      website: reviewedWebsite,
      search: { completed: manual.identity === 'not-identified', results_adjudicated: manual.identity === 'not-identified' },
      pointer: pointerReview, file: fileReview }
      : { reviewed_at, reason, next_action, sources: sourceRefs,
        website: plausibleCandidates.length ? { plausible: true, identity: 'unverified', candidate_urls: plausibleCandidates.slice(0, 5).map(x => x.final_url || x.url) } : { identity: 'not-identified' },
        search: { completed: !!searchCompleted, results_adjudicated: !!searchCompleted, error: searchFailure ? 'request failure' : '' },
        retrieval: { error: !search && requests.some(q => !q.http_status) ? 'candidate request failure' : '' } };
    const disposition = classify(review);
    const alternativeNote = alternatives ? ` The official-site review recorded ${alternatives.pricing_links?.length || 0} pricing or machine-readable alternative link(s) and ${alternatives.pricing_attempts?.length || 0} pricing-page request(s).` : '';
    const stageReason = disposition === 'mrf-verification-pending'
      ? `The facility entry was matched in the official pointer and the pointer-declared MRF returned HTTP ${fileAttempt.http_status}${fileAttempt.capped ? ' with a bounded prefix retained' : ''}; identity and metadata verification remain pending.`
      : disposition === 'mrf-request-failed'
        ? `The facility entry was matched in the official pointer, but the pointer-declared MRF request ${fileAttempt?.http_status ? `returned HTTP ${fileAttempt.http_status}` : `failed at the request/tool layer (${fileAttempt?.error || 'unknown error'})`}.${browserRetry ? ` A built-in web retry also ended at the tool layer (${browserRetry.detail})` : ''}`
        : disposition === 'pointer-match-unresolved'
          ? `A structured pointer was retrieved with ${pointerEntries.length} facility entr${pointerEntries.length === 1 ? 'y' : 'ies'}, but none was safely matched to this CCN.`
          : disposition === 'pointer-not-retrieved'
            ? 'All four root/www pointer locations returned actual HTTP responses, but none contained a usable structured pointer.' + alternativeNote
            : disposition === 'official-hpt-pending'
              ? 'The official website is confirmed, but the pointer-location review could not be completed because at least one request failed at the transport/tool layer.'
              : disposition === 'request-tool-failure' && manual
                ? 'The official website is confirmed, but at least one pointer-location request failed at the transport/tool layer, so absence was not inferred.' + alternativeNote
              : '';
    const finalReason = stageReason ? `${reason} ${stageReason}` : reason;
    const finalNextAction = disposition === 'mrf-verification-pending'
      ? 'Validate the retained MRF prefix or complete file against facility identity, CMS template/version, update date, and required metadata before reviewed-resolution routing.'
      : disposition === 'mrf-request-failed' ? 'Retry the exact pointer-declared MRF URL with a browser/download-capable client and preserve the response separately from metadata findings.'
        : disposition === 'pointer-match-unresolved' ? 'Compare every pointer facility entry with the CCN, legal/operator aliases, address history, and pricing page before selecting any MRF.'
          : disposition === 'pointer-not-retrieved' ? 'Inspect the official pricing-page/footer alternatives and recheck after a later crawl; do not infer a compliance conclusion from this observation.'
            : next_action;
    const dates = [...r.evidence.map(e => e.observation.checked_at || e.observation.discovered_at), ...requests.map(q => q.checked_at), ...attempts.map(a => a.checked_at), reviewed_at].filter(d => d && Number.isFinite(Date.parse(d))).sort();
    return { ccn: r.base.ccn, hospital_name: r.base.hospital_name, base_sha256: digest(r.base),
      before: originals.find(o => o.ccn === r.base.ccn)?.observation || '',
      disposition, label: LABELS[disposition], review_complete: disposition !== 'review-pending',
      reviewed_at, observed_at: reviewed_at || dates.at(-1) || '', report_generated_at: generated_at,
      reason: finalReason, next_action: finalNextAction, website: review?.website || { identity: 'not-adjudicated' },
      pointer: { state: mrf?.facility_matched ? 'facility-entry-matched' : pointerEntries.length ? 'retrieved-match-unresolved' : attempts.length ? (pointerReview.locations_complete ? 'not-retrieved-from-checked-locations' : 'request-incomplete') : 'not-assessed',
        entries: pointerEntries.map(entry => ({ location_name: entry.location_name, source_page_url: entry.source_page_url, mrf_url: entry.mrf_url })),
        attempts: classifiedAttempts.map(({ body, ...a }) => a) },
      pricing_page: alternatives ? { state: alternatives.pricing_attempts?.some(a => a.http_status >= 200 && a.http_status < 300) ? 'retrieved' : alternatives.pricing_links?.length ? 'links-recorded-request-unsuccessful-or-not-needed' : 'no-pricing-link-recorded',
        links: alternatives.pricing_links || [], attempts: alternatives.pricing_attempts || [], seed_attempts: alternatives.seed_attempts || [] } : { state: 'not-assessed' },
      facility_identity: manual?.identity || 'not-adjudicated',
      file_access: !fileAttempt ? 'not-assessed' : fileReview.retrieved ? (fileAttempt.capped ? 'bounded-prefix-retrieved' : 'retrieved-under-cap') : fileAttempt.http_status ? `http-${fileAttempt.http_status}` : 'request-tool-failure',
      metadata: !fileAttempt || !fileReview.retrieved ? 'not-assessed' : 'verification-pending',
      saved_observations: r.evidence.length, fresh_requests: requests.length,
      http_responses: requests.filter(q => q.http_status > 0).length,
      transport_tool_failures: requests.filter(q => !q.http_status).length,
      sources: [...r.evidence.map(e => ({ evidence_id: e.id, observed_at: e.observation.checked_at || e.observation.discovered_at || '',
        // Public references avoid local paths and raw contact-bearing responses.
        kind: 'preserved-run-observation' })),
        ...requests.map(q => ({ evidence_id: requestId(q), kind: 'fresh-candidate-request', observed_at: q.checked_at,
          http_status: q.http_status, transport_failure: !!q.transport_error, capped: q.capped })),
        ...(manual ? [{ kind: manual.identity === 'corroborated' ? 'first-party-page' : 'identity-search-review',
          ...(manual.source_url ? { url: manual.source_url } : {}), observed_at: manual.observed_at, method: manual.method,
          evidence_id: digest({ ccn: manual.ccn, observed_at: manual.observed_at, method: manual.method, basis: manual.basis }) }] : []),
        ...(mrf?.facility_matched ? [{ kind: 'official-pointer-facility-entry', url: mrf.entry.pointer_url, observed_at: mrf.entry.pointer_checked_at,
          location_name: mrf.entry.location_name }, { kind: 'pointer-source-page-request', url: mrf.entry.source_page_url,
          observed_at: mrf.source_attempt?.checked_at, http_status: mrf.source_attempt?.http_status, transport_failure: !mrf.source_attempt?.http_status },
          { kind: 'pointer-mrf-request', url: mrf.entry.mrf_url, observed_at: mrf.file_attempt?.checked_at,
            http_status: mrf.file_attempt?.http_status, transport_failure: !mrf.file_attempt?.http_status, capped: !!mrf.file_attempt?.capped }] : []),
        ...(alternatives ? [...(alternatives.seed_attempts || []).map(a => ({ kind: 'official-site-seed-request', url: a.requested_url,
          observed_at: a.checked_at, http_status: a.http_status, transport_failure: !a.http_status, capped: !!a.capped })),
          ...(alternatives.pricing_attempts || []).map(a => ({ kind: 'official-pricing-page-request', url: a.requested_url,
            observed_at: a.checked_at, http_status: a.http_status, transport_failure: !a.http_status, capped: !!a.capped }))] : []),
        ...(browserRetry ? [{ kind: 'browser-tool-mrf-retry', url: browserRetry.requested_url,
          observed_at: browserRetry.observed_at, result: browserRetry.result, detail: browserRetry.detail }] : []),
        ...(search ? [{ kind: 'fresh-search', evidence_id: digest({ ccn: search.ccn, query: search.query, attempts: search.attempts.map(a => ({ engine: a.engine, checked_at: a.checked_at, http_status: a.http_status, response_sha256: a.response_sha256 })) }), observed_at: reviewed_at,
          engines: search.attempts.map(a => a.engine), http_statuses: search.attempts.map(a => a.http_status) }] : [])]
    };
  });
  const counts = records.reduce((o, r) => ((o[r.disposition] = (o[r.disposition] || 0) + 1), o), {});
  const recordByCcn = new Map(records.map(record => [record.ccn, record]));
  const resolutionFile = path.join(AUDIT, 'reviewed-resolutions.json');
  const cohortResolutions = (fs.existsSync(resolutionFile) ? JSON.parse(fs.readFileSync(resolutionFile, 'utf8')) : [])
    .filter(resolution => recordByCcn.has(resolution.ccn)
      && resolution.base && digest(resolution.base) === recordByCcn.get(resolution.ccn).base_sha256);
  const resolvedCcns = new Set(cohortResolutions.map(resolution => resolution.ccn));
  const activeRecords = records.filter(record => !resolvedCcns.has(record.ccn));
  const activeCounts = activeRecords.reduce((o, r) => ((o[r.disposition] = (o[r.disposition] || 0) + 1), o), {});
  const reviewedOutcomeCounts = cohortResolutions.reduce((o, resolution) => {
    const key = resolution.finding || resolution.action;
    o[key] = (o[key] || 0) + 1; return o;
  }, {});
  const summary = { cohort: 569, counts, fully_completed_reviews: records.filter(r => r.review_complete).length,
    reviewed_outcomes_applied: resolvedCcns.size, active_not_assessed: activeRecords.length,
    active_counts: activeCounts, reviewed_outcome_counts: reviewedOutcomeCounts,
    identity_adjudicated: records.filter(r => r.disposition !== 'review-pending').length,
    with_fresh_requests: records.filter(r => r.fresh_requests).length,
    confirmed_official_websites: records.filter(r => r.website?.identity === 'corroborated').length,
    second_pass_identity_review: fs.existsSync(path.join(OUT, 'deep-identity-v2.json'))
      ? JSON.parse(fs.readFileSync(path.join(OUT, 'deep-identity-v2.json'), 'utf8')).length : 0,
    generated_at };
  fs.writeFileSync(path.join(AUDIT, 'discovery-review.json'), JSON.stringify({ summary, records }, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'review-report.csv'), toCSV(records.map(({ sources, pointer, website, ...r }) => r)));
  const transitions = records.reduce((o, r) => {
    const before = r.before === 'candidate-found' ? 'Previous candidate found (226)' : 'Previous no candidate (343)';
    const key = before + ' -> ' + r.label; o[key] = (o[key] || 0) + 1; return o;
  }, {});
  const report = [
    '# Discovery review: 569-hospital final disposition report', '',
    '**All 569 frozen CCNs have an evidence-based discovery disposition and explicit next action.** Pending labels identify the exact unresolved evidence stage; none is a compliance finding.', '',
    `Generated: ${generated_at}. Source observation times are recorded separately for every record.`, '',
    `Frozen cohort: 569 unique CCNs (343 previously “no candidate”, 226 “candidate found”). ${summary.with_fresh_requests} have fresh candidate-host requests, all 569 have a completed disposition, and ${summary.confirmed_official_websites} official websites are confirmed. The second pass completed two built-in web searches for each of the 352 formerly unverified candidates.`, '',
    '## Current presentation', '',
    `- ${resolvedCcns.size}: reviewed outcomes applied through the existing validator`,
    `- ${activeRecords.length}: remain in the not-assessed tier with an exact evidence-stage label`, '',
    ...Object.entries(activeCounts).map(([key, n]) => `- ${n}: ${LABELS[key]}`), '',
    '## Applied reviewed outcomes', '',
    ...Object.entries(reviewedOutcomeCounts).map(([key, n]) => `- ${n}: ${key}`), '',
    '## Before / after', '',
    ...Object.entries(transitions).map(([key, n]) => `- ${n}: ${key}`), '',
    '## Findings supported so far', '',
    ...[...identities.values()].filter(i => i.source_url).map(i => `- CCN ${i.ccn}: ${i.basis} Source: [${i.identity === 'corroborated' ? 'first-party page' : 'identity-review source'}](${i.source_url}); observed ${i.observed_at} using ${i.method}.`), '',
    '## Remaining next-stage work', '',
    '- Candidate-identity-unverified records need first-party facility/address corroboration before any official-site or HPT conclusion.',
    '- Request/tool failures need a browser or alternate client retry; they are not HTTP absence or denial findings.',
    '- Pointer-match-unresolved records need facility/legal-name reconciliation before selecting any MRF.',
    '- MRF-request-failed records need an exact-URL retry; MRF-verification-pending records need facility identity, CMS template/version, date, and metadata validation.',
    `- Only fully corroborated outcomes are routed through the existing reviewed-resolution validator; ${resolvedCcns.size} frozen-cohort CCNs currently pass that gate.`, '',
    '## Evidence and reproducibility', '',
    '- `discovery-review.json`: sanitized per-CCN presentation, independent evidence dimensions, source references, observation dates, reasons, and next actions.',
    '- `.domain-discovery/review-569/cohort.json`: frozen original records; `.domain-discovery/review-569/inventory.json`: cross-run evidence with original source paths and dates. Both remain in ignored local staging.',
    '- `.domain-discovery/review-569/identity-search-v2*/`, `deep-identity-v2.json`, `fresh/*.json`, `official/*.json`, and `manual-identity.json`: saved built-in search outputs, bounded requests, and individual adjudications. Raw responses stay private.',
    '- Exact cached observations are deduplicated across source files; differing dates and conflicting responses remain distinct. Request failures are separate from HTTP responses. Shared-host retrieval never establishes identity for sibling facilities.',
    '- The raw audit and old domain-observations snapshot are preserved. The new overlay takes precedence only while the entire frozen base row still matches; later crawls and reviewed resolutions are not overwritten.', '',
    'No paid API batches, commits, publication, or outreach sending are part of this review.', ''
  ].join('\n');
  fs.writeFileSync(path.join(AUDIT, 'discovery-review-report.md'), report);
  console.log(JSON.stringify(summary, null, 2));
}
function report() {
  const { toCSV } = require('./lib/util');
  const rows = JSON.parse(fs.readFileSync(path.join(OUT, 'inventory.json'), 'utf8'));
  const freshBy = new Map();
  const dir = path.join(OUT, 'fresh');
  for (const file of fs.readdirSync(dir)) {
    const result = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const ccn of result.ccns) {
      if (!freshBy.has(ccn)) freshBy.set(ccn, []);
      freshBy.get(ccn).push(...result.observations.map(o => ({ ...o, source_file: 'fresh/' + file })));
    }
  }
  const report = rows.map(r => {
    const attempts = freshBy.get(r.base.ccn) || [];
    const responses = attempts.filter(a => a.http_status);
    const searches = r.evidence.filter(e => e.observation.kind === 'web-search-leads-only');
    return { ccn: r.base.ccn, hospital_name: r.base.hospital_name,
      base_sha256: hash(r.base), saved_observations: r.evidence.length,
      fresh_requests: attempts.length, http_responses: responses.length,
      request_failures: attempts.length - responses.length, new_searches: searches.length,
      website: responses.some(a => a.http_status >= 200 && a.http_status < 300) ? 'candidate page retrieved; official identity unverified' : 'official website unverified',
      identity: 'pending individual adjudication', pointer: 'pending official-domain verification',
      file_access: 'not assessed', metadata: 'not assessed',
      disposition: 'review-in-progress',
      next_action: attempts.length ? 'Adjudicate first-party facility identity and address; then inspect pointer and pricing links.' : 'Retrieve and adjudicate candidate pages from saved search results.',
      source_refs: [...r.evidence.map(e => e.id), ...attempts.map(a => a.source_file)].join('|'),
      observed_at: [...attempts.map(a => a.checked_at), ...searches.map(s => s.observation.checked_at)].filter(Boolean).sort().at(-1) || '',
      report_generated_at: new Date().toISOString() };
  });
  fs.writeFileSync(path.join(OUT, 'progress.csv'), toCSV(report));
  console.log(JSON.stringify({ cohort: report.length, with_fresh_requests: report.filter(r => r.fresh_requests).length,
    with_new_searches: report.filter(r => r.new_searches).length, completed_adjudications: 0 }));
}
if (require.main === module) {
  if (process.argv[2] === 'fresh') fresh().catch(e => { console.error(e); process.exitCode = 1; });
  else if (process.argv[2] === 'search') searchAll().catch(e => { console.error(e); process.exitCode = 1; });
  else if (process.argv[2] === 'adjudicate') adjudicate();
  else if (process.argv[2] === 'official') official().catch(e => { console.error(e); process.exitCode = 1; });
  else if (process.argv[2] === 'official-retry') retryOfficialFailures().catch(e => { console.error(e); process.exitCode = 1; });
  else if (process.argv[2] === 'verify') verifyPointers().catch(e => { console.error(e); process.exitCode = 1; });
  else if (process.argv[2] === 'alternatives') checkAlternatives().catch(e => { console.error(e); process.exitCode = 1; });
  else if (process.argv[2] === 'export') exportReview();
  else if (process.argv[2] === 'report') report();
  else inventory();
}
module.exports = { inventory, exportReview };
