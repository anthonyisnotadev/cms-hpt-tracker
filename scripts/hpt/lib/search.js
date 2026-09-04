'use strict';
/**
 * Pluggable web-search adapter for hospital domain discovery.
 *
 * Search quality barely matters here: every candidate domain is verified for
 * free by fetching its cms-hpt.txt and checking the location names inside, so a
 * wrong result costs one HTTP request rather than a bad row. That makes the
 * cheapest provider with adequate recall the right choice, and it is why the
 * default is Serper because its 2,500-query trial fits a focused discovery run.
 *
 * Select with HPT_SEARCH=serper|decodo|exa.
 */

const { JsonStore, pooled } = require('./util');

/** Result hosts that are never a hospital's own site. */
const BAD_DOMAIN = /(wikipedia|wikimedia|facebook|linkedin|yelp|indeed|glassdoor|healthgrades|usnews|medicare\.gov|cms\.gov|hospitalsafetygrade|vitals\.com|webmd|ratemds|npidb|hipaaspace|bloomberg|zoominfo|mapquest|tripadvisor|instagram|twitter|x\.com|youtube|crunchbase|dnb\.com|bizapedia|manta\.com|apple\.com|google\.|bing\.|amazon\.com|ziprecruiter|monster\.com|careerbuilder|foursquare|nih\.gov|cdc\.gov|census\.gov)/i;

const PROVIDERS = {
  /** Serper - Google results with a 2,500-query trial. */
  serper: {
    envKeys: ['SERPER_API_KEY'],
    async search(query, { num = 8, timeoutMs = 20000 } = {}) {
      const r = await withTimeout(timeoutMs, signal => fetch('https://google.serper.dev/search', {
        method: 'POST', signal,
        headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, num, gl: 'us', hl: 'en' })
      }));
      if (!r.ok) return { results: [], error: `serper http ${r.status}` };
      const j = await r.json();
      return { results: (j.organic || []).map(o => ({ url: o.link, title: o.title || '' })) };
    }
  },

  /** Decodo SERP - $0.32/1k, same vendor as the unblocker. */
  decodo: {
    envKeys: ['DECODO_USERNAME', 'DECODO_PASSWORD'],
    async search(query, { num = 8, timeoutMs = 60000 } = {}) {
      const auth = Buffer.from(`${process.env.DECODO_USERNAME}:${process.env.DECODO_PASSWORD}`).toString('base64');
      const r = await withTimeout(timeoutMs, signal => fetch('https://scraper-api.decodo.com/v2/scrape', {
        method: 'POST', signal,
        headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'google_search', query, parse: true, geo: 'United States' })
      }));
      if (!r.ok) return { results: [], error: `decodo http ${r.status}` };
      const j = await r.json();
      const content = j && j.results && j.results[0] && j.results[0].content;
      const organic = (content && content.results && content.results.organic) || [];
      return { results: organic.slice(0, num).map(o => ({ url: o.url || o.link, title: o.title || '' })) };
    }
  },

  /** Exa - kept working, but the most expensive option at $7/1k. */
  exa: {
    envKeys: ['EXA_API_KEY'],
    async search(query, { num = 8, timeoutMs = 20000 } = {}) {
      const r = await withTimeout(timeoutMs, signal => fetch('https://api.exa.ai/search', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.EXA_API_KEY },
        body: JSON.stringify({ query, numResults: num, type: 'auto' })
      }));
      if (!r.ok) return { results: [], error: `exa http ${r.status}` };
      const j = await r.json();
      return { results: (j.results || []).map(o => ({ url: o.url, title: o.title || '' })) };
    }
  }
};

function withTimeout(ms, fn) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return Promise.resolve(fn(ac.signal)).finally(() => clearTimeout(t));
}

const hasKeys = p => p.envKeys.every(k => !!process.env[k]);

/** The configured provider, or the first one whose credentials are present. */
function activeSearchProvider() {
  const want = String(process.env.HPT_SEARCH || '').toLowerCase();
  if (want) {
    const p = PROVIDERS[want];
    if (!p) return null;
    return hasKeys(p) ? { name: want, ...p } : null;
  }
  for (const [name, p] of Object.entries(PROVIDERS)) if (hasKeys(p)) return { name, ...p };
  return null;
}

/**
 * Search for a hospital and return plausible domains, best first. Obvious
 * directory and social hosts are dropped; everything surviving is a candidate
 * for the free verifier, not an answer.
 */
async function searchHospitalDomains(hospital, opts = {}) {
  const prov = opts.provider || activeSearchProvider();
  if (!prov) return { domains: [], error: 'no search provider configured' };
  const query = `${hospital.name} hospital ${hospital.city} ${hospital.state} official website`;
  const { results, error } = await prov.search(query, opts);
  if (error) return { domains: [], error, provider: prov.name };
  const candidates = candidateDomainsFromResults(results);
  return { domains: candidates.map(row => row.domain), candidates, provider: prov.name, query };
}

function candidateDomainsFromResults(results) {
  const seen = new Set();
  const candidates = [];
  for (const res of results) {
    let host = '';
    try { host = new URL(res.url).hostname.toLowerCase().replace(/^www\./, ''); } catch (_e) { continue; }
    if (!host || BAD_DOMAIN.test(host) || seen.has(host)) continue;
    seen.add(host);
    candidates.push({ domain: host, url: String(res.url || ''),
      title: String(res.title || '').replace(/\s+/g, ' ').trim().slice(0, 240) });
  }
  return candidates;
}

/** One paid query per hospital, with sanitized, resumable result caching. */
async function runSearchDiscovery({ jobs, cacheFile, maxQueries = Infinity,
  concurrency = 5, timeoutMs = 20000, num = 6, refresh = false,
  retryErrors = false, provider = activeSearchProvider() }) {
  if (!provider) throw new Error('No search provider configured');
  const store = new JsonStore(cacheFile);
  await store.load();
  let cacheHits = 0;
  const pending = [];
  for (const job of jobs) {
    const cached = store.get(job.ccn);
    if (!refresh && cached && (!cached.error || !retryErrors)) cacheHits++;
    else if (pending.length < maxQueries) pending.push(job);
  }
  let requests = 0;
  let completed = 0;
  let saveChain = Promise.resolve();
  await pooled(pending, {
    concurrency,
    onProgress: done => {
      if (done === pending.length || done % 25 === 0) console.log(`Search ${done}/${pending.length}`);
    }
  }, async job => {
    requests++;
    const result = await searchHospitalDomains({ ...job, name: job.hospital_name || job.name }, {
      provider, num, timeoutMs
    });
    store.set(job.ccn, {
      ccn: job.ccn, provider: provider.name, query: result.query || '',
      candidates: result.candidates || [], error: result.error || '',
      checked_at: new Date().toISOString()
    });
    if (++completed % 25 === 0) {
      saveChain = saveChain.then(() => store.save(true));
      await saveChain;
    }
  });
  await saveChain;
  await store.save(true);
  return { provider: provider.name, requests, cacheHits,
    rows: jobs.map(job => store.get(job.ccn)).filter(Boolean) };
}

module.exports = {
  searchHospitalDomains, candidateDomainsFromResults, runSearchDiscovery,
  activeSearchProvider, PROVIDERS, BAD_DOMAIN
};
