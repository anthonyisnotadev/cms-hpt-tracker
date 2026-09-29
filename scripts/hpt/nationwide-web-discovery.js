'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { directGet } = require('./lib/fetch');
const { candidateScore, officialLooking } = require('./deepen-candidate-identities');
const { upsert, validate } = require('./nationwide-search-review');

const ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(ROOT, 'data', 'hpt-audit');
const PRIVATE = path.join(ROOT, 'cms_data', 'hpt', 'nationwide-verification', 'web-search');
const REVIEW_FILE = path.join(AUDIT, 'nationwide-search-reviews.json');
const DIRECTORY = /(^|\.)(healthgrades|turquoise\.health|npiprofile|usnews|yelp|mapquest|facebook|linkedin|wikipedia|bbb\.org|ahd\.com|cms\.gov|carecompare|vitadox|sharecare|vitals|yellowpages|chamberofcommerce|jointcommission|hospitalinspections|jcipatientsafety|freida\.ama-assn)(\/|$)/i;

function hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }
function resultLinks(engine, body) {
  const $ = cheerio.load(body || ''), links = [];
  const nodes = engine === 'google' ? $('a:has(h3)') : $('li.b_algo h2 a');
  nodes.each((_, el) => {
    let href = $(el).attr('href') || '';
    if (href.startsWith('/url?')) href = new URL(href, 'https://www.google.com').searchParams.get('q') || '';
    try {
      let url = new URL(href);
      if (engine === 'bing' && /(^|\.)bing\.com$/i.test(url.hostname)) {
        const encoded = url.searchParams.get('u') || '';
        if (encoded.startsWith('a1')) url = new URL(Buffer.from(encoded.slice(2), 'base64url').toString('utf8'));
      }
      if (!/^https?:$/.test(url.protocol) || /(^|\.)(google|bing)\./i.test(url.hostname)) return;
      const container = engine === 'google' ? $(el).parent().parent() : $(el).closest('li.b_algo');
      links.push({ url: url.href, host: url.hostname.toLowerCase(), title: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 240),
        text: container.text().replace(/\s+/g, ' ').trim().slice(0, 2000) });
    } catch {}
  });
  return [...new Map(links.map(link => [link.url, link])).values()].slice(0, 12);
}

function inputs() {
  const queue = JSON.parse(fs.readFileSync(path.join(ROOT, 'cms_data', 'hpt', 'nationwide-verification', 'search-queue.json'), 'utf8'));
  const reviewed = fs.existsSync(REVIEW_FILE) ? JSON.parse(fs.readFileSync(REVIEW_FILE, 'utf8')).records || [] : [];
  const done = new Set(reviewed.filter(record => record.status !== 'search-error').map(record => record.ccn));
  const roster = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, 'cms_data', 'hpt', 'roster.json'), 'utf8')).map(row => [row.ccn, row]));
  return queue.filter(row => row.status === 'pending' && !done.has(row.ccn)).map(row => ({ ...row, ...roster.get(row.ccn),
    hospital_name: row.hospital_name, candidate_urls: [] }));
}

async function search() {
  fs.mkdirSync(PRIVATE, { recursive: true });
  const jobs = inputs(); let next = 0, completed = 0;
  const refresh = process.argv.includes('--refresh');
  async function worker() { while (next < jobs.length) {
    const row = jobs[next++], outFile = path.join(PRIVATE, `${row.ccn}.json`);
    if (fs.existsSync(outFile) && !refresh) { completed++; continue; }
    const query = `\"${row.hospital_name}\" \"${row.address}\" ${row.city} ${row.state} official hospital`;
    const attempts = [];
    for (const engine of ['google', 'bing']) {
      const url = `${engine === 'google' ? 'https://www.google.com/search?q=' : 'https://www.bing.com/search?q='}${encodeURIComponent(query)}`;
      const response = await directGet(url, { timeoutMs: 20000, maxBytes: 786432 });
      attempts.push({ engine, checked_at: new Date().toISOString(), http_status: response.status,
        transport_error: response.error || '', capped: !!response.tooLarge, response_sha256: hash(response.body),
        results: resultLinks(engine, response.body), raw_body: response.body || '' });
      if (attempts.at(-1).results.length >= 5) break;
    }
    const candidates = [...new Map(attempts.flatMap(attempt => attempt.results).map(item => [item.url, item])).values()]
      .filter(item => !DIRECTORY.test(new URL(item.url).hostname + new URL(item.url).pathname)).slice(0, 5);
    const pages = [];
    for (const candidate of candidates) {
      const response = await directGet(candidate.url, { timeoutMs: 15000, maxBytes: 524288 });
      const $ = cheerio.load(response.body || '');
      pages.push({ ...candidate, final_url: response.finalUrl || candidate.url, checked_at: new Date().toISOString(),
        http_status: response.status, transport_error: response.error || '', capped: !!response.tooLarge,
        body_sha256: hash(response.body), text: $('body').text().replace(/\s+/g, ' ').trim().slice(0, 200000) });
    }
    fs.writeFileSync(outFile, JSON.stringify({ ccn: row.ccn, query, attempts, pages }));
    if (++completed % 25 === 0 || completed === jobs.length) console.log(`Nationwide searches ${completed}/${jobs.length}`);
    await new Promise(resolve => setTimeout(resolve, 150));
  }}
  await Promise.all(Array.from({ length: 4 }, worker));
}

function adjudicateOne(row, saved) {
  const scored = (saved.pages || []).filter(page => page.http_status >= 200 && page.http_status < 300)
    .map(page => candidateScore(row, { url: page.final_url || page.url, host: new URL(page.final_url || page.url).hostname.toLowerCase(),
      title: page.title, text: `${page.title} ${page.text}` }))
    .sort((a, b) => b.score - a.score);
  const official = scored.find(candidate => candidate.identity_match && officialLooking(row, candidate));
  const observed_at = [...(saved.attempts || []).map(a => a.checked_at), ...(saved.pages || []).map(p => p.checked_at)].filter(Boolean).sort().at(-1) || new Date().toISOString();
  if (official) return validate({ ccn: row.ccn, hospital_name: row.hospital_name, city: row.city, state: row.state,
    status: 'official', domain: official.host.replace(/^www\./, ''), candidate_url: '', name_evidence: official.url,
    address_evidence: official.url, query: saved.query,
    reason: `Fresh search and a bounded first-party page read matched the facility name, roster street address (${row.address}), and ${row.city}, ${row.state}.`,
    search_source: 'google-bing-plus-bounded-page', observed_at });
  const plausible = scored.find(candidate => officialLooking(row, candidate) && candidate.city_hit && candidate.name_hits.length);
  if (plausible) return validate({ ccn: row.ccn, hospital_name: row.hospital_name, city: row.city, state: row.state,
    status: 'candidate', domain: '', candidate_url: plausible.url, name_evidence: '', address_evidence: '', query: saved.query,
    reason: `Fresh search found a plausible operator or facility page in ${row.city}, ${row.state}, but the bounded page did not corroborate the roster street address (${row.address}).`,
    search_source: 'google-bing-plus-bounded-page', observed_at });
  const usable = (saved.attempts || []).filter(a => a.http_status >= 200 && a.http_status < 300 && a.results?.length);
  const status = usable.length ? 'completed-no-official' : 'search-error';
  return validate({ ccn: row.ccn, hospital_name: row.hospital_name, city: row.city, state: row.state,
    status, domain: '', candidate_url: '', name_evidence: '', address_evidence: '', query: saved.query,
    reason: status === 'completed-no-official'
      ? 'Fresh search results and bounded candidate-page reads did not establish an operator-controlled site matching both facility identity and location.'
      : 'Fresh search requests did not return a usable result set; no negative website conclusion was drawn.',
    search_source: 'google-bing-plus-bounded-page', observed_at });
}

function adjudicate() {
  const jobs = inputs();
  let document = fs.existsSync(REVIEW_FILE) ? JSON.parse(fs.readFileSync(REVIEW_FILE, 'utf8')) : { schema_version: 1, records: [] };
  const counts = {};
  for (const row of jobs) {
    const file = path.join(PRIVATE, `${row.ccn}.json`);
    if (!fs.existsSync(file)) continue;
    const record = adjudicateOne(row, JSON.parse(fs.readFileSync(file, 'utf8')));
    document = upsert(document, record);
    counts[record.status] = (counts[record.status] || 0) + 1;
  }
  fs.writeFileSync(REVIEW_FILE, JSON.stringify(document, null, 2) + '\n');
  console.log(JSON.stringify({ adjudicated: Object.values(counts).reduce((a, b) => a + b, 0), counts }, null, 2));
}

if (require.main === module) {
  if (process.argv[2] === 'search') search().catch(error => { console.error(error); process.exitCode = 1; });
  else if (process.argv[2] === 'adjudicate') adjudicate();
  else throw Error('Usage: node scripts/hpt/nationwide-web-discovery.js <search|adjudicate>');
}

module.exports = { resultLinks, adjudicateOne };
