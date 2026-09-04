'use strict';
/**
 * Candidate domain generators.
 *
 * Every candidate produced here is a guess, and that is fine: the verifier
 * fetches `/cms-hpt.txt` and checks the location names inside, so a wrong
 * candidate costs one free HTTP request rather than a bad row. Sources are
 * therefore tuned for recall, not precision, and the cheapest sources run
 * before anything that charges per query.
 */
const { hostOf, isAggregator, nameSimilarity, strictSimilarity, JsonStore, pooled } = require('./util');
const { chatJson } = require('./openrouter');

const STATE_ABBREV = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC', 'puerto rico': 'PR'
};

const WIKIDATA_SPARQL = `SELECT ?hLabel ?site ?stateLabel WHERE {
  ?h wdt:P31/wdt:P279* wd:Q16917 ;
     wdt:P17 wd:Q30 ;
     wdt:P856 ?site .
  OPTIONAL { ?h wdt:P131 ?state }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
} LIMIT 20000`;

/**
 * Fetch US hospitals that publish an official website on Wikidata.
 *
 * The query takes ~45s and the endpoint drops connections under load, so a
 * transient failure is retried rather than silently skipping the whole source.
 */
async function fetchWikidata({ timeoutMs = 180000, attempts = 3 } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    if (i) await new Promise(r => setTimeout(r, 5000 * i));
    last = await fetchWikidataOnce({ timeoutMs });
    if (last.rows.length) return last;
  }
  return last;
}

async function fetchWikidataOnce({ timeoutMs = 180000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(WIKIDATA_SPARQL);
    const r = await fetch(url, {
      signal: ac.signal,
      headers: {
        Accept: 'application/sparql-results+json',
        // Wikidata asks for an identifying agent on API traffic.
        'User-Agent': 'cms-hpt-harvester/1.0 (CMS price transparency research)'
      }
    });
    if (!r.ok) return { rows: [], error: `wikidata http ${r.status}` };
    const j = await r.json();
    const rows = (j.results.bindings || []).map(b => ({
      name: b.hLabel ? b.hLabel.value : '',
      domain: hostOf(b.site ? b.site.value : ''),
      state: b.stateLabel ? (STATE_ABBREV[b.stateLabel.value.toLowerCase()] || '') : ''
    })).filter(x => x.name && x.domain && !isAggregator(x.domain));
    return { rows };
  } catch (e) {
    return { rows: [], error: String((e && e.message) || e) };
  } finally { clearTimeout(t); }
}

/**
 * Match Wikidata rows to hospitals needing a domain. The threshold is loose
 * because verification is free; a state mismatch is only a demotion, not a
 * rejection, since Wikidata's administrative-region label is often missing.
 */
function wikidataCandidates(hospitals, rows, { threshold = 0.70 } = {}) {
  const byState = new Map();
  for (const r of rows) {
    const k = r.state || '*';
    if (!byState.has(k)) byState.set(k, []);
    byState.get(k).push(r);
  }
  const out = new Map();
  for (const h of hospitals) {
    const pool = [...(byState.get(h.state) || []), ...(byState.get('*') || [])];
    const scored = [];
    for (const r of pool) {
      const s = nameSimilarity(h.name, r.name);
      if (s >= threshold) scored.push({ domain: r.domain, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const picks = [];
    for (const c of scored) {
      if (seen.has(c.domain)) continue;
      seen.add(c.domain);
      picks.push({ domain: c.domain, source: 'wikidata', score: Number(c.score.toFixed(3)) });
      if (picks.length >= 3) break;
    }
    if (picks.length) out.set(h.ccn, picks);
  }
  return out;
}

// Words that carry no identity and would otherwise dominate a guessed domain.
const GENERIC = new Set([
  'hospital', 'hospitals', 'medical', 'center', 'centre', 'health', 'healthcare',
  'inc', 'llc', 'the', 'of', 'and', 'system', 'systems', 'regional', 'county',
  'district', 'memorial', 'community', 'general', 'campus', 'at', 'a', 'an'
]);

/**
 * Guess domains straight from the hospital's name. Free, unlimited, and
 * surprisingly effective for independent hospitals, which are exactly the ones
 * missing from the aggregated open datasets.
 */
function heuristicCandidates(hospital, { maxPerHospital = 14 } = {}) {
  const toks = String(hospital.name || '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const core = toks.filter(t => !GENERIC.has(t));
  const j = a => a.join('');
  const bases = new Set();
  bases.add(j(toks));
  if (core.length) {
    bases.add(j(core));
    bases.add(core[0]);
    bases.add(core[0] + 'health');
    bases.add(core[0] + 'hospital');
    bases.add(core[0] + 'medical');
  }
  if (core.length >= 2) {
    bases.add(j(core.slice(0, 2)));
    bases.add(j(core.slice(0, 2)) + 'health');
  }
  const out = [];
  for (const b of bases) {
    if (b.length < 4 || b.length > 40) continue;
    for (const tld of ['.org', '.com']) {
      out.push({ domain: b + tld, source: 'heuristic', score: 0 });
      if (out.length >= maxPerHospital) return out;
    }
  }
  return out;
}

/**
 * Propose the domain of a near-miss orphan entry. A system file that mentions a
 * hospital under a slightly different name is strong evidence that the domain
 * is worth checking for that hospital.
 */
function orphanCandidates(hospitals, orphanEntries, { threshold = 0.60 } = {}) {
  const out = new Map();
  for (const h of hospitals) {
    const picks = [];
    for (const o of orphanEntries) {
      if (!o.locationName || !o.domain) continue;
      const s = nameSimilarity(h.name, o.locationName);
      if (s < threshold) continue;
      picks.push({ domain: o.domain, source: 'orphan', score: Number(s.toFixed(3)) });
    }
    if (!picks.length) continue;
    picks.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const uniq = [];
    for (const p of picks) {
      if (seen.has(p.domain)) continue;
      seen.add(p.domain);
      uniq.push(p);
      if (uniq.length >= 3) break;
    }
    out.set(h.ccn, uniq);
  }
  return out;
}

/**
 * Ask an LLM for each hospital's official website domain.
 *
 * Worth doing because the model has memorised a great many hospital websites,
 * and because a hallucinated domain is harmless here: `verify` fetches
 * /cms-hpt.txt and checks the names inside, so a wrong guess costs one free
 * request. Hospitals are batched to keep the token cost near nothing, and each
 * answer echoes the CCN back so a mis-aligned reply can be discarded.
 */
async function llmDomainCandidates(hospitals, { batchSize = 8, timeoutMs = 90000, model } = {}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { map: new Map(), error: 'OPENROUTER_API_KEY not set' };
  const mdl = model || process.env.OPENROUTER_MODEL || '~deepseek/deepseek-v4-flash-latest';

  const lines = hospitals.slice(0, batchSize).map(h =>
    `${h.ccn} | ${h.name} | ${h.city}, ${h.state} ${h.zip || ''}`.trim());

  const sys = `You know the websites of US hospitals. For each hospital, give the domain of its OWN official website, plus the domain of its parent health system if it has one.

Rules:
- Return bare domains only: "stjosephhospital.org", never a URL or path.
- Prefer the hospital's own site first, then the parent system.
- Directory, news, and review sites are useless: never return wikipedia, healthgrades, yelp, usnews, medicare.gov, facebook, or similar.
- If you do not know, return an empty list for that hospital. A guess you are unsure of is still worth returning ONLY if it is a plausible domain for that exact hospital.
- Echo back the CCN exactly as given.`;

  const user = `Give the official website domain(s) for each hospital:\n\n${lines.join('\n')}\n\nReturn JSON: {"hospitals":[{"ccn":"...","domains":["..."]}]}`;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ac.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: mdl,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }]
      })
    });
    if (!r.ok) return { map: new Map(), error: `openrouter http ${r.status}` };
    const j = await r.json();
    const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!content) return { map: new Map(), error: 'empty completion' };
    let parsed;
    try { parsed = JSON.parse(content); }
    catch (_e) {
      const m = String(content).match(/\{[\s\S]*\}/);
      if (!m) return { map: new Map(), error: 'unparseable' };
      try { parsed = JSON.parse(m[0]); } catch (_e2) { return { map: new Map(), error: 'unparseable' }; }
    }
    const valid = new Set(hospitals.map(h => h.ccn));
    const map = new Map();
    for (const row of (parsed.hospitals || [])) {
      const ccn = String(row.ccn || '').trim();
      if (!valid.has(ccn)) continue;         // discard mis-aligned rows
      const picks = [];
      for (const d of (row.domains || []).slice(0, 3)) {
        const host = hostOf(/^https?:\/\//i.test(d) ? d : `https://${d}`);
        if (!host || isAggregator(host)) continue;
        picks.push({ domain: host, source: 'llm', score: 0.5 });
      }
      if (picks.length) map.set(ccn, picks);
    }
    return { map };
  } catch (e) {
    return { map: new Map(), error: String((e && e.message) || e).slice(0, 140) };
  } finally { clearTimeout(t); }
}

function llmDomainPrompt(hospitals, aliases = new Map()) {
  const rows = hospitals.map(hospital => ({
    ccn: hospital.ccn,
    cms_name: hospital.hospital_name || hospital.name || '',
    address: hospital.address || '',
    city: hospital.city || '',
    state: hospital.state || '',
    zip: hospital.zip || '',
    nppes_organization_aliases: (aliases.get(hospital.ccn) || []).slice(0, 12)
  }));
  return JSON.stringify({ hospitals: rows });
}

/**
 * Generate resumable domain leads for every selected hospital. These are only
 * leads: callers must still verify the root pointer and its MRF header.
 */
async function runLlmDomainDiscovery({ hospitals, aliases = new Map(), cacheFile,
  batchSize = 8, concurrency = 2, timeoutMs = 90000,
  model = 'z-ai/glm-5.3-flash', refresh = false, retryErrors = true,
  client = chatJson }) {
  const store = new JsonStore(cacheFile);
  await store.load();
  let cacheHits = 0;
  const pending = [];
  for (const hospital of hospitals) {
    const cached = store.get(hospital.ccn);
    if (!refresh && cached && (!cached.error || !retryErrors)) cacheHits++;
    else pending.push(hospital);
  }
  const batches = [];
  for (let i = 0; i < pending.length; i += Math.max(1, batchSize)) {
    batches.push(pending.slice(i, i + Math.max(1, batchSize)));
  }
  let requests = 0;
  let completed = 0;
  let saveChain = Promise.resolve();
  await pooled(batches, {
    concurrency,
    onProgress: done => {
      if (done === batches.length || done % 10 === 0) console.log(`GLM domain batches ${done}/${batches.length}`);
    }
  }, async batch => {
    requests++;
    const result = await client({
      model,
      timeoutMs,
      temperature: 0,
      system: `Identify likely current official website domains for US hospitals. The CMS identity and NPPES organization aliases are leads. Return up to three bare domains per hospital, ordered from most likely to least likely. Prefer a hospital-owned domain, then its parent health system. Include a plausible low-confidence domain guess when you are uncertain because every answer will be checked live. Use an empty domains array only when no plausible official domain comes to mind. Never return directories, social networks, news sites, storage hosts, or government provider directories. These answers are candidates only and will be verified against the hospital-hosted cms-hpt.txt file and its MRF header.`,
      user: llmDomainPrompt(batch, aliases),
      schema: {
        name: 'hospital_domain_candidates', strict: true,
        schema: {
          type: 'object', additionalProperties: false, required: ['hospitals'],
          properties: {
            hospitals: {
              type: 'array', items: {
                type: 'object', additionalProperties: false,
                required: ['ccn', 'domains'], properties: {
                  ccn: { type: 'string' },
                  domains: {
                    type: 'array', maxItems: 3, items: {
                      type: 'object', additionalProperties: false,
                      required: ['domain', 'confidence', 'reason'], properties: {
                        domain: { type: 'string' },
                        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                        reason: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });
    const byCcn = new Map(((result.data && result.data.hospitals) || [])
      .map(row => [String(row.ccn || '').trim(), row]));
    for (const hospital of batch) {
      const answer = byCcn.get(hospital.ccn);
      if (result.error) {
        store.set(hospital.ccn, { ccn: hospital.ccn, domains: [], error: result.error,
          model, checked_at: new Date().toISOString() });
        continue;
      }
      const seen = new Set();
      const domains = [];
      for (const suggestion of (answer && answer.domains || []).slice(0, 3)) {
        const host = hostOf(/^https?:\/\//i.test(suggestion.domain)
          ? suggestion.domain : `https://${suggestion.domain}`);
        if (!host || seen.has(host) || isAggregator(host)) continue;
        seen.add(host);
        domains.push({ domain: host,
          confidence: ['high', 'medium', 'low'].includes(suggestion.confidence) ? suggestion.confidence : 'low',
          reason: String(suggestion.reason || '').replace(/\s+/g, ' ').trim().slice(0, 300) });
      }
      store.set(hospital.ccn, { ccn: hospital.ccn, domains, error: '', model: result.model || model,
        checked_at: new Date().toISOString() });
    }
    if (++completed % 10 === 0) {
      saveChain = saveChain.then(() => store.save(true));
      await saveChain;
    }
  });
  await saveChain;
  await store.save(true);
  const rows = hospitals.map(hospital => store.get(hospital.ccn)
    || { ccn: hospital.ccn, domains: [], error: 'not-processed', model });
  return { rows, requests, cacheHits };
}

module.exports = {
  fetchWikidata, wikidataCandidates, heuristicCandidates, orphanCandidates,
  llmDomainCandidates, llmDomainPrompt, runLlmDomainDiscovery,
  STATE_ABBREV, GENERIC
};
