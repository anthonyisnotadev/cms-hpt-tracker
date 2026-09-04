'use strict';
const { hostOf, sleep } = require('./util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BROWSER_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/plain,text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Cache-Control': 'no-cache'
};

/** True when the body actually looks like a CMS HPT pointer file rather than an error page. */
function looksLikePointer(body) {
  if (!body) return false;
  const s = String(body);
  if (/^\s*[[{]/.test(s.trim())) {
    try {
      const j = JSON.parse(s);
      const arr = Array.isArray(j) ? j : (Array.isArray(j && j.locations) ? j.locations : [j]);
      if (arr.some(o => o && (
        o['mrf-url'] || o.mrf_url || o.mrfUrl ||
        o['location-name'] || o.location_name || o.locationName
      ))) return true;
    } catch (_e) { /* fall through to key:value sniffing */ }
  }
  return /mrf-url\s*:/i.test(s) || (/location-name\s*:/i.test(s) && /source-page-url\s*:/i.test(s));
}

function classify(status, body) {
  if (status === 0) return 'neterr';
  if (status === 401 || status === 403 || status === 429) return 'blocked';
  if (status === 404 || status === 410) return 'notfound';
  if (status >= 500) return 'server';
  if (status >= 200 && status < 300) {
    if (looksLikePointer(body)) return 'ok';
    if (/<html|<!doctype/i.test(String(body || '').slice(0, 500))) return 'html';
    return 'empty';
  }
  return 'http' + status;
}

/** Plain, free fetch. No proxy, no cost. */
async function readTextCapped(res, maxBytes) {
  if (!maxBytes) {
    const body = await res.text();
    return { body, tooLarge: false, bytesRead: Buffer.byteLength(body) };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch (_e) {}
      return { body: '', tooLarge: true, bytesRead: total };
    }
    chunks.push(Buffer.from(value));
  }
  return { body: Buffer.concat(chunks).toString('utf8'), tooLarge: false, bytesRead: total };
}

async function directGet(url, { timeoutMs = 20000, maxBytes = 0, fetchImpl = fetch } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { redirect: 'follow', signal: ac.signal, headers: BROWSER_HEADERS });
    const read = await readTextCapped(r, maxBytes);
    return { status: r.status, body: read.body, tooLarge: read.tooLarge, bytesRead: read.bytesRead, finalUrl: r.url || url, via: 'direct' };
  } catch (e) {
    return { status: 0, body: '', finalUrl: url, via: 'direct', error: String((e && e.message) || e) };
  } finally { clearTimeout(timer); }
}

/**
 * Unblocker providers. Oxylabs and Decodo both expose a realtime "scrape this
 * URL" JSON endpoint with basic auth and a {results:[{content,status_code}]}
 * response, so one adapter shape covers both. Select with HPT_UNBLOCKER.
 */
const PROVIDERS = {
  oxylabs: {
    endpoint: 'https://realtime.oxylabs.io/v1/queries',
    userEnv: 'OXYLABS_USERNAME',
    passEnv: 'OXYLABS_PASSWORD',
    body: (url, render) => {
      const p = { source: 'universal', url, geo_location: 'United States' };
      if (render) p.render = 'html';
      return p;
    }
  },
  decodo: {
    endpoint: 'https://scraper-api.decodo.com/v2/scrape',
    userEnv: 'DECODO_USERNAME',
    passEnv: 'DECODO_PASSWORD',
    body: (url, render) => {
      const p = { url, geo: 'United States' };
      if (render) p.headless = 'html';
      return p;
    }
  }
};

function activeProvider() {
  const want = String(process.env.HPT_UNBLOCKER || '').toLowerCase();
  if (want && PROVIDERS[want]) {
    const p = PROVIDERS[want];
    if (process.env[p.userEnv] && process.env[p.passEnv]) return { name: want, ...p };
    return null;
  }
  for (const [name, p] of Object.entries(PROVIDERS)) {
    if (process.env[p.userEnv] && process.env[p.passEnv]) return { name, ...p };
  }
  return null;
}

/** Paid fetch through the configured unblocker. Only reached after the free path fails. */
async function unblockerGet(url, { timeoutMs = 90000, render = false } = {}) {
  const prov = activeProvider();
  if (!prov) return { status: 0, body: '', via: 'unblocker', error: 'no unblocker credentials configured' };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const auth = Buffer.from(`${process.env[prov.userEnv]}:${process.env[prov.passEnv]}`).toString('base64');
    const r = await fetch(prov.endpoint, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(prov.body(url, render))
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { status: r.status, body: '', via: prov.name, error: `${prov.name} http ${r.status}: ${t.slice(0, 200)}` };
    }
    const j = await r.json();
    const res = (j && j.results && j.results[0]) || null;
    if (!res) return { status: 0, body: '', via: prov.name, error: 'no results in response' };
    const content = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    return {
      status: res.status_code || 200,
      body: content,
      finalUrl: res.url || url,
      via: prov.name + (render ? '+render' : '')
    };
  } catch (e) {
    return { status: 0, body: '', via: prov.name, error: String((e && e.message) || e) };
  } finally { clearTimeout(timer); }
}

/** Every place CMS permits the pointer file to live, most likely first. */
function pointerCandidates(domain) {
  const d = String(domain).replace(/^www\./, '');
  return [
    `https://${d}/cms-hpt.txt`,
    `https://www.${d}/cms-hpt.txt`,
    `https://${d}/.well-known/cms-hpt.txt`,
    `https://www.${d}/.well-known/cms-hpt.txt`
  ];
}

/**
 * Tiered acquisition for one domain:
 *   1. free direct fetch of each candidate path
 *   2. follow a homepage redirect to a new canonical host (system rebrands)
 *   3. paid unblocker, but only when tier 1 saw a real block
 * Returns the first genuine pointer file, else the most informative failure.
 */
async function fetchPointer(domain, opts = {}) {
  const { useUnblocker = true, timeoutMs = 20000, maxBytes = 0, fetchImpl = fetch, onNote = null } = opts;
  const note = m => { if (onNote) onNote(m); };
  const attempts = [];
  let sawBlock = false;

  for (const url of pointerCandidates(domain)) {
    const r = await directGet(url, { timeoutMs, maxBytes, fetchImpl });
    const kind = r.tooLarge ? 'too-large' : classify(r.status, r.body);
    attempts.push({ url, status: r.status, kind, via: r.via });
    if (kind === 'ok') return { ok: true, domain, url, finalUrl: r.finalUrl, body: r.body, via: r.via, attempts };
    if (kind === 'blocked') sawBlock = true;
  }

  // Tier 2: the domain may have been folded into a parent system since the seed
  // data was collected. The homepage redirect reveals the new canonical host.
  let home = await directGet(`https://${domain}/`, { timeoutMs, maxBytes, fetchImpl });
  if (!home.status) {
    const insecureLead = await directGet(`http://${domain}/`, { timeoutMs, maxBytes, fetchImpl });
    attempts.push({ url: `http://${domain}/`, status: insecureLead.status,
      kind: classify(insecureLead.status, insecureLead.body), via: 'http-redirect-lead' });
    if (insecureLead.status) home = insecureLead;
  }
  const canon = hostOf(home.finalUrl);
  if (canon && canon !== String(domain).replace(/^www\./, '')) {
    note(`${domain} -> redirects to ${canon}`);
    for (const url of pointerCandidates(canon).slice(0, 2)) {
      const r = await directGet(url, { timeoutMs, maxBytes, fetchImpl });
      const kind = r.tooLarge ? 'too-large' : classify(r.status, r.body);
      attempts.push({ url, status: r.status, kind, via: 'redirect' });
      if (kind === 'ok') {
        return { ok: true, domain, redirectedTo: canon, url, finalUrl: r.finalUrl, body: r.body, via: 'redirect', attempts };
      }
      if (kind === 'blocked') sawBlock = true;
    }
  }
  if (classify(home.status, '') === 'blocked') sawBlock = true;

  // Tier 3: paid. Only worth spending on domains that actively refused us.
  if (useUnblocker && sawBlock && activeProvider()) {
    for (const url of pointerCandidates(domain).slice(0, 2)) {
      const r = await unblockerGet(url);
      const kind = classify(r.status, r.body);
      attempts.push({ url, status: r.status, kind, via: r.via, error: r.error });
      if (kind === 'ok') return { ok: true, domain, url, finalUrl: r.finalUrl, body: r.body, via: r.via, attempts };
      await sleep(250);
    }
  }

  const kinds = attempts.map(a => a.kind);
  const reason = kinds.includes('blocked') ? 'blocked'
    : kinds.includes('too-large') ? 'too-large'
    : kinds.every(k => k === 'notfound') ? 'notfound'
    : kinds.includes('html') ? 'html'
    : kinds.includes('neterr') ? 'neterr' : 'failed';
  return { ok: false, domain, reason, attempts, homeStatus: home.status, canon: canon || null };
}

/**
 * One-shot check used when testing speculative candidate domains.
 *
 * `fetchPointer` tries five URLs plus a homepage redirect, which is right for a
 * domain we believe in but far too expensive when most candidates are guesses.
 * This spends a single request and a short timeout, so a wrong guess is cheap.
 */
async function quickPointer(domain, { timeoutMs = 8000, maxBytes = 4194304 } = {}) {
  const d = String(domain).replace(/^www\./, '');
  const r = await directGet(`https://${d}/cms-hpt.txt`, { timeoutMs, maxBytes });
  const kind = classify(r.status, r.body);
  return kind === 'ok'
    ? { ok: true, domain: d, url: `https://${d}/cms-hpt.txt`, body: r.body, via: 'quick', bytesRead: r.bytesRead || 0 }
    : { ok: false, domain: d, reason: kind, status: r.status, bytesRead: r.bytesRead || 0 };
}

/**
 * Last resort when no pointer file exists: CMS also requires a homepage footer
 * link to the standard-charges page, so harvest MRF links from that page.
 */
async function discoverViaFooter(domain, { timeoutMs = 20000, maxPages = 3 } = {}) {
  const home = await directGet(`https://${domain}/`, { timeoutMs });
  if (!home.body) return { ok: false, reason: 'no-homepage' };
  const base = home.finalUrl || `https://${domain}/`;
  const abs = u => { try { return new URL(u, base).toString(); } catch (_e) { return ''; } };
  const links = [...home.body.matchAll(/href=["']([^"'>\s]+)["']/gi)].map(m => m[1]);
  const candidates = [...new Set(links
    .filter(l => /price|transparen|standard-?charges|chargemaster|cost-?estimat/i.test(l))
    .map(abs).filter(Boolean))].slice(0, maxPages);

  const mrfUrls = new Set();
  const pagesScanned = [];
  for (const page of candidates) {
    const r = await directGet(page, { timeoutMs });
    if (!r.body) continue;
    pagesScanned.push(page);
    for (const u of [...r.body.matchAll(/href=["']([^"'>\s]+)["']/gi)].map(m => abs(m[1])).filter(Boolean)) {
      if (/\.(csv|json|xlsx?)(\.gz)?($|[?#])/i.test(u) && /charge|price|transparen|mrf|standard/i.test(u)) {
        mrfUrls.add(u);
      }
    }
  }
  return { ok: mrfUrls.size > 0, mrfUrls: [...mrfUrls], pagesScanned, via: 'footer-scan' };
}

module.exports = {
  directGet, unblockerGet, fetchPointer, quickPointer, discoverViaFooter,
  pointerCandidates, classify, looksLikePointer, activeProvider, BROWSER_HEADERS
};
