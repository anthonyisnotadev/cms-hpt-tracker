'use strict';
/**
 * LLM-guided fallback for domains that publish no cms-hpt.txt pointer file.
 *
 * The free `discoverViaFooter` pass (lib/fetch.js) greps the homepage for a link
 * whose text or href contains "price"/"transparency"/etc, then greps that page
 * for a *.csv/*.json link. It misses whenever the nav label is something like
 * "Patient Financial Resources", the link sits behind a script-built menu, or
 * the price page links the file two hops deep. It also returns a bag of URLs
 * with no verification that the file it found is *this* hospital's.
 *
 * This module keeps the same "site footer is the other half of the rule"
 * premise but drives the two hops with a model, then applies the SAME
 * corroboration gate the `match`/`corroborate` stages use before accepting a
 * URL: the MRF header's own licensing state (or failing that, its hospital_name)
 * must agree with the CMS record. A scraped link that cannot be corroborated is
 * returned with ok:false and kept for manual review, never silently trusted.
 *
 * Cost per domain: at most 2 model calls (pick nav links, then pick the file),
 * at most ~5 plain GETs, and one ranged header probe. Nothing here reaches a
 * paid unblocker — blocked domains are a different bucket.
 */

const { directGet } = require('./fetch');
const { probeMrf } = require('./probe');
const { hostOf, nameSimilarity } = require('./util');
const { guessFormat } = require('./parse');
const { chatJson } = require('./openrouter');

const PICK_SCHEMA = {
  name: 'nav_links', strict: true,
  schema: {
    type: 'object',
    properties: {
      links: { type: 'array', items: { type: 'string' }, description: 'up to 3 hrefs, copied exactly, best first' },
      reason: { type: 'string', description: 'one sentence' }
    },
    required: ['links', 'reason'],
    additionalProperties: false
  }
};

const FIND_SCHEMA = {
  name: 'mrf_link', strict: true,
  schema: {
    type: 'object',
    properties: {
      mrfUrl: { type: 'string', description: 'the machine-readable file URL, copied exactly, or "" if none present' },
      sourcePageUrl: { type: 'string', description: 'the page the mrfUrl was linked from, or ""' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      reason: { type: 'string' }
    },
    required: ['mrfUrl', 'sourcePageUrl', 'confidence', 'reason'],
    additionalProperties: false
  }
};

const PICK_SYSTEM = `You are given the link list from a US hospital website homepage. Pick the links most likely to lead to the page that publishes the hospital's machine-readable standard charges file (the CMS price-transparency file: one large CSV or JSON, also called "machine-readable file" or "standard charges", required by 45 CFR 180).

Prefer links whose text or URL mentions: price transparency, standard charges, machine readable, chargemaster data, cms-hpt, hospital charges.
Avoid: patient price estimator / cost estimator tools, financial assistance or charity care, accepted-insurance lists, bill pay / make a payment, careers, news, PDF-only chargemasters.
Return up to 3 hrefs, best first, each copied EXACTLY from the list. If nothing fits, return an empty list.`;

const FIND_SYSTEM = `You are finding the URL of a hospital's machine-readable standard charges FILE itself, not the page describing it.

The file is a single large CSV, JSON, or XLSX, sometimes compressed (.zip / .gz). Its name commonly contains a 9-digit EIN, the hospital or system name, or "standardcharges" / "standard_charges" / "machine_readable" / "MRF".
It is NOT: a PDF, a price-estimator web tool, a data dictionary or format guide, an insurance-rates page, or an old-year file when a current-year one is also listed.

Some hospital-system pages list files for many facilities. Use the target hospital's name, city and state (given below) to choose the right one.

From the candidate pages and their file links below, return the single best mrfUrl and the sourcePageUrl it was linked from, both copied EXACTLY. If no machine-readable file link appears on any page, return mrfUrl "".`;

/** Pull <a href> pairs (href + visible anchor text) out of an HTML string. */
function extractLinks(html, base) {
  const abs = u => { try { return new URL(u, base).toString(); } catch (_e) { return ''; } };
  const seen = new Set();
  const out = [];
  // Tolerate quoted and unquoted href values: bare-bones hospital price pages
  // routinely emit <a href=/docs/foo.csv> with no quotes, and that is exactly
  // the link this stage is hunting for.
  const re = /<a\b[^>]*?\bhref=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 600) {
    const raw = (m[1] || m[2] || m[3] || '').trim();
    if (!raw || raw.startsWith('#') || /^(javascript|tel):/i.test(raw)) continue;
    const href = abs(raw);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const text = m[4].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    out.push({ href, text });
  }
  return out;
}

const PRICE_HINT = /price|transparen|standard[-_ ]?charge|chargemaster|charge[-_ ]?master|machine[-_ ]?readable|cms[-_ ]?hpt|cost[-_ ]?estimat/i;
const FILE_HINT = /\.(csv|json|xlsx?|zip|gz)(\?|#|$)/i;

/** Rank the homepage link list so the model sees the plausible ones first, capped for token cost. */
function rankLinks(links, sameHost) {
  const scored = links.map(l => {
    let s = 0;
    if (PRICE_HINT.test(l.href) || PRICE_HINT.test(l.text)) s += 3;
    if (FILE_HINT.test(l.href)) s += 2;
    if (sameHost && hostOf(l.href) === sameHost) s += 1;
    return { ...l, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, 60).map(({ href, text }) => ({ href, text }));
}

function renderLinkList(links) {
  return links.map((l, i) => `${i + 1}. ${l.text ? `[${l.text}] ` : ''}${l.href}`).join('\n');
}

/**
 * Corroborate a candidate MRF against the hospital(s) the domain is assigned to,
 * using only what the header probe already read for free.
 *
 * Mirrors the ladder in run.js `match`: licensing state is decisive when
 * present, hospital_name similarity is the fallback, and a bare valid CMS date
 * on a single-hospital domain is accepted at low confidence. Anything else is
 * left unconfirmed rather than guessed.
 */
function corroborate(probe, hospitals) {
  const states = new Set(hospitals.map(h => h.state).filter(Boolean));
  if (probe && probe.mrfLicenseState) {
    if (states.has(probe.mrfLicenseState)) {
      return { accepted: true, confidence: 'high', reason: `MRF header license state ${probe.mrfLicenseState} matches hospital state` };
    }
    return { accepted: false, confidence: 'high', reason: `MRF header license state ${probe.mrfLicenseState} != hospital state ${[...states].join('/') || '(unknown)'}` };
  }
  if (probe && probe.mrfHospitalName && hospitals.length) {
    let best = 0, bestName = '';
    for (const h of hospitals) {
      const s = nameSimilarity(probe.mrfHospitalName, h.name || '');
      if (s > best) { best = s; bestName = h.name; }
    }
    if (best >= 0.6) {
      return { accepted: true, confidence: 'medium', reason: `MRF hospital_name "${probe.mrfHospitalName}" ~ "${bestName}" (${best.toFixed(2)}); no license state in header` };
    }
    return { accepted: false, confidence: 'medium', reason: `MRF hospital_name "${probe.mrfHospitalName}" does not match roster (best ${best.toFixed(2)})` };
  }
  if (hospitals.length === 1 && probe && probe.declaredLastUpdated) {
    return { accepted: true, confidence: 'low', reason: 'single-hospital domain; file carries a valid CMS last_updated_on but the header had no identifying fields' };
  }
  return { accepted: false, confidence: 'low', reason: 'no corroborating evidence in the MRF header' };
}

/**
 * Try to recover an MRF URL for one pointer-less domain.
 *
 * @param {object}   o
 * @param {string}   o.domain
 * @param {object[]} o.hospitals   roster rows ({ ccn, name, city, state, ... }) assigned to this domain
 * @param {object}  [opts]
 * @param {number}  [opts.timeoutMs=25000]     per page fetch / header probe
 * @param {number}  [opts.llmTimeoutMs=90000]  per model call (DeepSeek runs slow)
 * @param {number}  [opts.maxPages=4]
 * @param {string}  [opts.model]
 * @returns {Promise<object>} always resolves; ok:true only when a URL passed corroboration
 */
async function recoverViaLlm({ domain, hospitals }, opts = {}) {
  const { timeoutMs = 25000, llmTimeoutMs = 90000, maxPages = 4, model } = opts;
  const target = hospitals[0] || {};
  const base = `https://${domain}/`;
  const fail = (reason, extra) => ({ ok: false, reason, domain, ...extra });

  const home = await directGet(base, { timeoutMs });
  if (!home.body) return fail('no-homepage', { homeStatus: home.status });
  const finalBase = home.finalUrl || base;
  const sameHost = hostOf(finalBase);
  const homeLinks = extractLinks(home.body, finalBase);
  if (!homeLinks.length) return fail('no-links');

  // Hop 1: which nav links lead to the price-transparency page.
  const ranked = rankLinks(homeLinks, sameHost);
  const pick = await chatJson({
    system: PICK_SYSTEM,
    user: `Hospital: ${target.name || '(unknown)'} — ${target.city || ''}, ${target.state || ''}\nHomepage: ${finalBase}\n\nLinks:\n${renderLinkList(ranked)}`,
    schema: PICK_SCHEMA, model, timeoutMs: llmTimeoutMs
  });

  const abs = u => { try { return new URL(u, finalBase).toString(); } catch (_e) { return ''; } };
  const known = new Set(ranked.map(l => l.href));
  let pages = [];
  if (pick.data && Array.isArray(pick.data.links)) {
    pages = pick.data.links.map(abs).filter(u => u && (known.has(u) || hostOf(u) === sameHost));
  }
  // Union with the cheap heuristic so the model can never do worse than the
  // regex-only pass: any homepage link that itself looks like a price page.
  for (const l of homeLinks) {
    if (pages.length >= maxPages) break;
    if (PRICE_HINT.test(l.href) && !pages.includes(l.href)) pages.push(l.href);
  }
  pages = [...new Set(pages)].slice(0, maxPages);
  if (!pages.length) return fail('no-price-page', { pickReason: (pick.data && pick.data.reason) || pick.error });

  // Fetch the candidate pages; collect their file links + a text snippet.
  const pageData = [];
  const directFileHits = [];
  for (const url of pages) {
    const r = await directGet(url, { timeoutMs });
    if (!r.body) continue;
    const links = extractLinks(r.body, r.finalUrl || url);
    const fileLinks = links.filter(l => FILE_HINT.test(l.href));
    for (const f of fileLinks) {
      if (/standard[-_ ]?charge|machine[-_ ]?readable|\bmrf\b|chargemaster/i.test(f.href + ' ' + f.text)) {
        directFileHits.push({ mrfUrl: f.href, sourcePageUrl: r.finalUrl || url });
      }
    }
    const text = r.body
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1500);
    pageData.push({ url: r.finalUrl || url, fileLinks: fileLinks.slice(0, 25), text });
  }
  if (!pageData.length) return fail('price-pages-unreachable');

  // Hop 2: pick the actual file.
  const rendered = pageData.map(p =>
    `PAGE: ${p.url}\nfile links:\n${p.fileLinks.length ? p.fileLinks.map(f => `  ${f.text ? `[${f.text}] ` : ''}${f.href}`).join('\n') : '  (none)'}\ntext: ${p.text}`
  ).join('\n\n');
  const find = await chatJson({
    system: FIND_SYSTEM,
    user: `Target hospital: ${target.name || '(unknown)'} — ${target.city || ''}, ${target.state || ''}\n\n${rendered}`,
    schema: FIND_SCHEMA, model, timeoutMs: llmTimeoutMs
  });

  let mrfUrl = '', sourcePageUrl = '', llmConfidence = '', llmReason = '';
  if (find.data && find.data.mrfUrl) {
    mrfUrl = abs(find.data.mrfUrl);
    sourcePageUrl = abs(find.data.sourcePageUrl) || (pageData[0] && pageData[0].url) || '';
    llmConfidence = find.data.confidence || '';
    llmReason = find.data.reason || '';
  }
  // Fall back to a deterministic file hit if the model declined but the page
  // plainly had a standard-charges file link.
  if (!mrfUrl && directFileHits.length) {
    mrfUrl = directFileHits[0].mrfUrl;
    sourcePageUrl = directFileHits[0].sourcePageUrl;
    llmConfidence = 'low';
    llmReason = 'model returned no url; used a page link whose name contains "standard charges"';
  }
  if (!mrfUrl) return fail('no-mrf-found', { pickReason: (pick.data && pick.data.reason) || pick.error, findError: find.error });

  // Verify + corroborate: read the header (free, ranged) and check it agrees
  // with the CMS record before accepting.
  const probe = await probeMrf(mrfUrl, { timeoutMs, useUnblocker: false });
  const probeSlim = probe ? {
    httpStatus: probe.httpStatus, blocked: !!probe.blocked, fileKind: probe.fileKind,
    declaredLastUpdated: probe.declaredLastUpdated || null, declaredRaw: probe.declaredRaw || null,
    cmsVersion: probe.cmsVersion || null, staleOver365: probe.staleOver365 || false,
    daysSinceUpdate: probe.daysSinceUpdate === undefined ? null : probe.daysSinceUpdate,
    mrfLicenseState: probe.mrfLicenseState || null, mrfHospitalName: probe.mrfHospitalName || null,
    mrfAddress: probe.mrfAddress || null
  } : null;

  if (probe && (probe.blocked || (probe.httpStatus && probe.httpStatus >= 400))) {
    return {
      ok: false, reason: 'mrf-unreachable', domain, mrfUrl, sourcePageUrl,
      probe: probeSlim, llmConfidence, llmReason,
      corroboration: `MRF URL returned HTTP ${probe.httpStatus}${probe.blocked ? ' (blocked)' : ''}`
    };
  }

  const corro = corroborate(probeSlim, hospitals);
  return {
    ok: corro.accepted,
    reason: corro.accepted ? 'recovered' : 'unconfirmed',
    domain, mrfUrl, sourcePageUrl,
    mrfFormat: guessFormat(mrfUrl),
    probe: probeSlim,
    corroboration: corro.reason,
    corroborationConfidence: corro.confidence,
    llmConfidence, llmReason,
    model: find.model || pick.model || null
  };
}

module.exports = { recoverViaLlm, corroborate, extractLinks };
