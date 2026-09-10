'use strict';

/**
 * Raw HTTP evidence collector - the "curl -v" the tracker never kept.
 *
 * Re-fetches the URLs behind unresolved compliance findings using the same
 * browser-like headers as the production pipeline, and writes one reviewable
 * transcript per URL: DNS answer, every redirect hop, every response header,
 * a capped body excerpt, timing, and any connection-level error with its
 * underlying cause code. A CSV index plus summary.json sit next to them.
 *
 * Output lives under the tracked data/hpt-audit/curl-evidence/ directory and is
 * published with the site. Body excerpts are sanitized at render time with the
 * pointer archive's shared-key scheme: contact fields and any email-looking
 * string become hpt-obf:v1 tokens (decodable locally by scripts/static-files.js,
 * opaque to search engines), and set-cookie values are dropped entirely.
 *
 * Usage:
 *   node scripts/hpt/curl-evidence.js                     # all manual-review findings
 *   node scripts/hpt/curl-evidence.js --finding=mrf-blocked-to-automation
 *   node scripts/hpt/curl-evidence.js --ccn=100073,011311
 *   node scripts/hpt/curl-evidence.js https://bannerhealth.com/cms-hpt.txt
 *   node scripts/hpt/curl-evidence.js --finding=all --limit=20 --concurrency=8
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const dns = require('dns').promises;
const crypto = require('crypto');

const { csvToObjects, hostOf, pooled } = require('./lib/util');
const { BROWSER_HEADERS } = require('./lib/fetch');
const { loadKey, encryptValue, isObfuscated, protectPointerTextIfEnabled } = require('./lib/pointer-obfuscation');
const { protectContacts } = require('./lib/public-contact-text');

const ROOT = path.join(__dirname, '..', '..');
const COMPLIANCE = path.join(ROOT, 'data', 'hpt-audit', 'compliance.csv');
const DEFAULT_OUT = path.join(ROOT, 'data', 'hpt-audit', 'curl-evidence');

// The ranged MRF probes learned this the hard way (see run.js): after a body is
// read and dropped, some HTTP/2 servers reset the socket and undici surfaces
// that as an async 'error' event with no listener, killing a long crawl that
// had already finished its useful work. Exactly that class is absorbed here.
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

// Findings where human eyes on the raw exchange are the next useful step.
const MANUAL_FINDINGS = new Set([
  'pointer-blocked-to-automation',
  'mrf-blocked-to-automation',
  'mrf-url-unreachable',
  'not-assessed-site-unreachable',
  'no-cms-hpt-txt-published',
  'pointer-lists-no-mrf-url'
]);

function parseArgs(argv) {
  const urls = [];
  const opt = {};
  for (const arg of argv) {
    if (/^https?:\/\//i.test(arg)) urls.push(arg);
    else {
      const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
      if (m) opt[m[1]] = m[2] === undefined ? true : m[2];
    }
  }
  return { urls, opt };
}

const list = value => String(value || '').split(',').map(v => v.trim()).filter(Boolean);
const sha8 = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
const safeFile = value => String(value || 'host').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 100);

/** URLs worth capturing for one compliance row, by what its finding asserts. */
function urlsForRow(row) {
  const domain = String(row.domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  const out = [];
  switch (row.finding) {
    case 'mrf-blocked-to-automation':
    case 'mrf-url-unreachable':
      if (row.mrf_url) out.push(row.mrf_url);
      break;
    case 'pointer-lists-no-mrf-url':
      if (row.pointer_url) out.push(row.pointer_url);
      break;
    case 'pointer-blocked-to-automation':
    case 'not-assessed-site-unreachable':
      if (domain) out.push(`https://${domain}/cms-hpt.txt`, `https://${domain}/`);
      break;
    case 'no-cms-hpt-txt-published':
      if (domain) out.push(`https://${domain}/`, `https://${domain}/cms-hpt.txt`, `https://${domain}/.well-known/cms-hpt.txt`);
      break;
    default:
      if (domain) out.push(`https://${domain}/`);
  }
  return out;
}

function headersToObject(res) {
  const out = {};
  for (const [k, v] of res.headers.entries()) out[k.toLowerCase()] = v;
  return out;
}

async function readCapped(res, maxBytes) {
  const reader = res.body && res.body.getReader();
  if (!reader) return { text: '', read: 0, truncated: false };
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.length;
    if (n >= maxBytes) {
      try { await reader.cancel(); } catch (_e) {}
      return { text: Buffer.concat(chunks).toString('utf8'), read: n, truncated: true };
    }
  }
  return { text: Buffer.concat(chunks).toString('utf8'), read: n, truncated: false };
}

/** One URL: manual redirect walk, capped body, http:// fallback on transport errors. */
async function fetchEvidence(url, { timeoutMs, maxBody, maxRedirects = 8 }) {
  const started = Date.now();
  const result = { url, dns: null, hops: [], final: null, fallback: null, error: null, ms: 0 };
  const host = hostOf(url);

  try {
    const answers = await dns.lookup(host, { all: true });
    result.dns = answers.map(a => a.address);
  } catch (e) {
    result.dns = { error: `${e.code || ''} ${e.message}`.trim() };
  }

  async function walk(startUrl) {
    const hops = [];
    let current = startUrl;
    for (let i = 0; i <= maxRedirects; i++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      let res;
      try {
        res = await fetch(current, { redirect: 'manual', signal: ac.signal, headers: BROWSER_HEADERS });
      } catch (e) {
        clearTimeout(timer);
        const cause = e && e.cause && (e.cause.code || e.cause.message);
        return { hops, error: `${e.message}${cause ? ` (cause: ${cause})` : ''}` };
      }
      clearTimeout(timer);
      const headers = headersToObject(res);
      const hop = { url: current, status: res.status, headers, location: headers.location || '' };
      const isRedirect = res.status >= 300 && res.status < 400 && headers.location;
      if (!isRedirect) {
        const body = await readCapped(res, maxBody);
        hop.body = body;
        return { hops, final: hop };
      }
      hops.push(hop);
      // Drain the redirect body so the keep-alive socket is not left holding an
      // unconsumed stream - stranded streams are what trigger the idle-socket
      // resets absorbed above.
      try { await res.body.cancel(); } catch (_e) {}
      try { current = new URL(headers.location, current).toString(); }
      catch (_e) { return { hops, error: `unresolvable Location: ${headers.location}` }; }
    }
    return { hops, error: 'too many redirects' };
  }

  const primary = await walk(url);
  result.hops = primary.hops;
  result.final = primary.final || null;
  result.error = primary.error || null;

  // A transport failure on https:// deserves one plain-http attempt: sites with
  // broken TLS still serve content, and that distinction is reviewable evidence.
  if (primary.error && url.startsWith('https://')) {
    const httpUrl = url.replace(/^https:\/\//, 'http://');
    const secondary = await walk(httpUrl);
    result.fallback = {
      url: httpUrl,
      hops: secondary.hops,
      final: secondary.final || null,
      error: secondary.error || null
    };
  }
  result.ms = Date.now() - started;
  return result;
}

const BLOCK_BODY_HINT = /cdn-cgi\/challenge-platform|just a moment|attention required|access denied|cf-chl|enable javascript and cookies|unusual traffic|verify you are human|robot check/i;

function attributionOf(evidence) {
  const heads = [...evidence.hops, evidence.final, evidence.fallback && evidence.fallback.final]
    .filter(Boolean).map(h => h.headers || {});
  const pick = name => heads.map(h => h[name]).filter(Boolean).join(' | ');
  const server = pick('server');
  const cfRay = pick('cf-ray');
  const cfMitigated = pick('cf-mitigated');
  const wafAction = pick('x-amzn-waf-action');
  const body = String((evidence.final && evidence.final.body && evidence.final.body.text) || '');
  const bodyHint = BLOCK_BODY_HINT.test(body)
    ? (body.match(BLOCK_BODY_HINT) || [''])[0] : '';
  let edge = '';
  if (cfRay || cfMitigated || /cloudflare/i.test(server)) edge = 'cloudflare';
  else if (/akamai/i.test(server)) edge = 'akamai';
  else if (wafAction) edge = 'aws-waf';
  else if (/cloudfront/i.test(pick('via') || server)) edge = 'cloudfront';
  return { server, cf_ray: cfRay, cf_mitigated: cfMitigated, waf_action: wafAction, edge, body_hint: bodyHint };
}

// Response headers that never belong in a published transcript. Cookies are
// session material, not evidence about the hospital's price-transparency files.
const UNSAFE_RESPONSE_HEADERS = new Set(['set-cookie', 'set-cookie2']);

const EMAIL_LIKE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// contact-name/contact-email values not at line start - wrapped in HTML markup
// (<p>contact-email: ...</p>) or embedded in scripts - which the pointer
// archive's line-anchored regex cannot see.
const EMBEDDED_CONTACT = /((?:contact|contact[-_ ]?name|contact[-_ ]?email)\s*:\s*)([^<\r\n]{2,120})/gi;

/**
 * Make a body excerpt publishable. Contact fields become hpt-obf:v1 tokens via
 * the pointer archive's shared-key scheme (locally decodable, opaque to search
 * engines); any other email-looking string in markup is encrypted too. Applied
 * at render time, BEFORE the transcript's "< " line prefixing, because the
 * field-level obfuscator is line-anchored.
 */
function sanitizeBodyText(text, { keyFile } = {}) {
  let out = String(text || '');
  if (!out) return out;
  const key = loadKey({ keyFile }); // Never publish plaintext when the key is unavailable.
  if (key) {
    out = out.replace(EMBEDDED_CONTACT, (line, prefix, value) => {
      const trimmed = value.trim();
      // An @ means the email pass below will encrypt it as a whole address.
      if (!trimmed || isObfuscated(trimmed) || trimmed.includes('@')) return line;
      return prefix + encryptValue(trimmed, key);
    });
    out = out.replace(EMAIL_LIKE, match => (isObfuscated(match) ? match : encryptValue(match, key)));
  }
  // The line-anchored pointer protector handles well-formed pointer files.
  return protectContacts(protectPointerTextIfEnabled(out, keyFile ? { keyFile } : {}), key);
}

/** Response headers safe to publish: everything except cookie material. */
function renderableHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (!UNSAFE_RESPONSE_HEADERS.has(String(k).toLowerCase())) out[k] = v;
  }
  return out;
}

function renderTranscript(evidence, tasks, { keyFile } = {}) {
  const lines = [];
  const q = s => String(s || '');
  lines.push(`# curl-style evidence for ${evidence.url}`);
  lines.push(`# fetched ${new Date().toISOString()} with the tracker's BROWSER_HEADERS (production client)`);
  for (const t of tasks) lines.push(`# record: ${t.ccn} | ${t.name} | ${t.state} | finding: ${t.finding}`);
  lines.push('');
  lines.push(`* DNS ${q(evidence.url.split('/')[2])}: ${Array.isArray(evidence.dns) ? evidence.dns.join(', ') : q(evidence.dns && evidence.dns.error)}`);
  lines.push('');
  lines.push('> GET ' + new URL(evidence.url).pathname + '  (request headers sent on every hop)');
  for (const [k, v] of Object.entries(BROWSER_HEADERS)) lines.push(`> ${k}: ${v}`);
  lines.push('');
  const renderHop = (hop, label) => {
    lines.push(`* ${label}: ${hop.url}`);
    lines.push(`< HTTP ${hop.status}`);
    for (const [k, v] of Object.entries(renderableHeaders(hop.headers))) lines.push(`< ${k}: ${v}`);
    if (hop.location) lines.push(`* following Location: ${hop.location}`);
    if (hop.body) {
      lines.push(`< --- body (${hop.body.read} bytes read${hop.body.truncated ? ', truncated' : ''}) ---`);
      const text = sanitizeBodyText(hop.body.text.slice(0, 8192), keyFile ? { keyFile } : undefined);
      for (const line of text.split(/\r?\n/).slice(0, 120)) lines.push(`< ${line}`);
      if (text.length >= 8192) lines.push('< ... (body excerpt truncated at 8 KB)');
    }
    lines.push('');
  };
  evidence.hops.forEach((hop, i) => renderHop(hop, `redirect hop ${i + 1}`));
  if (evidence.final) renderHop(evidence.final, 'final response');
  if (evidence.error) { lines.push(`* error: ${evidence.error}`); lines.push(''); }
  if (evidence.fallback) {
    lines.push(`* http:// fallback attempt after transport failure:`);
    evidence.fallback.hops.forEach((hop, i) => renderHop(hop, `fallback redirect hop ${i + 1}`));
    if (evidence.fallback.final) renderHop(evidence.fallback.final, 'fallback final response');
    if (evidence.fallback.error) { lines.push(`* fallback error: ${evidence.fallback.error}`); lines.push(''); }
  }
  lines.push(`* total time: ${evidence.ms} ms`);
  return lines.join('\n') + '\n';
}

async function main() {
  const { urls: positionalUrls, opt } = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(opt.out || DEFAULT_OUT);
  const timeoutMs = Number(opt.timeout || 15000);
  const maxBody = Number(opt['max-body'] || 65536);
  const concurrency = Number(opt.concurrency || 8);
  const findingsWanted = opt.finding
    ? (opt.finding === 'all' ? null : new Set(list(opt.finding)))
    : MANUAL_FINDINGS;
  const ccnsWanted = new Set(list(opt.ccn));

  const tasks = [];
  if (positionalUrls.length) {
    for (const url of positionalUrls) tasks.push({ ccn: '', name: '(ad-hoc URL)', state: '', finding: 'ad-hoc', url });
  } else {
    const rows = csvToObjects((await fsp.readFile(COMPLIANCE, 'utf8')).replace(/^\uFEFF/, ''));
    for (const row of rows) {
      if (findingsWanted && !findingsWanted.has(row.finding)) continue;
      if (ccnsWanted.size && !ccnsWanted.has(row.ccn)) continue;
      for (const url of urlsForRow(row)) tasks.push({ ccn: row.ccn, name: row.hospital_name, state: row.state, finding: row.finding, url });
    }
    if (!tasks.length) throw new Error('No records matched the selected findings/CCNs');
  }
  if (opt.limit) tasks.length = Math.min(tasks.length, Number(opt.limit));

  const byUrl = new Map();
  for (const t of tasks) {
    if (!byUrl.has(t.url)) byUrl.set(t.url, []);
    byUrl.get(t.url).push(t);
  }
  const urls = [...byUrl.keys()];
  console.log(`Collecting raw evidence for ${urls.length} unique URLs (${tasks.length} record links)...`);

  const transcriptsDir = path.join(outDir, 'transcripts');
  await fsp.mkdir(transcriptsDir, { recursive: true });
  const transcriptFile = url => path.join(transcriptsDir, `${safeFile(hostOf(url))}--${sha8(url)}.txt`);

  const evidenceByUrl = new Map();
  const attrByUrl = new Map();

  const csvEscape = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const cols = ['ccn', 'hospital_name', 'state', 'finding', 'url', 'dns', 'final_status', 'redirect_hops',
    'server', 'cf_ray', 'cf_mitigated', 'waf_action', 'edge', 'body_hint', 'error', 'ms', 'transcript'];

  // Index rows are derived from whatever evidence has landed so far, so an
  // interrupted run still leaves a consistent index.csv matching the transcripts
  // on disk (a crash used to orphan the whole set).
  const indexRows = () => tasks.filter(t => evidenceByUrl.has(t.url)).map(t => {
    const e = evidenceByUrl.get(t.url);
    const a = attrByUrl.get(t.url) || {};
    const final = e.final || (e.fallback && e.fallback.final) || null;
    return {
      ccn: t.ccn, hospital_name: t.name, state: t.state, finding: t.finding,
      url: t.url,
      dns: Array.isArray(e.dns) ? 'ok' : 'failed',
      final_status: final ? final.status : '',
      redirect_hops: e.hops.length + ((e.fallback && e.fallback.hops.length) || 0),
      server: a.server, cf_ray: a.cf_ray, cf_mitigated: a.cf_mitigated,
      waf_action: a.waf_action, edge: a.edge, body_hint: a.body_hint,
      error: e.error || (e.fallback && e.fallback.error) || '',
      ms: e.ms,
      transcript: path.relative(outDir, transcriptFile(t.url))
    };
  });

  const writeIndexFiles = async () => {
    const index = indexRows();
    const byStatus = {};
    for (const r of index) byStatus[r.final_status || 'no-response'] = (byStatus[r.final_status || 'no-response'] || 0) + 1;
    const byEdge = {};
    for (const r of index) if (r.edge) byEdge[r.edge] = (byEdge[r.edge] || 0) + 1;
    const byError = {};
    for (const r of index) if (r.error) { const k = r.error.replace(/\(cause:.*$/, '').slice(0, 60); byError[k] = (byError[k] || 0) + 1; }
    const indexCsv = [cols.join(','), ...index.map(r => cols.map(c => csvEscape(r[c])).join(','))].join('\n') + '\n';
    await Promise.all([
      fsp.writeFile(path.join(outDir, 'index.csv'), indexCsv, 'utf8'),
      fsp.writeFile(path.join(outDir, 'summary.json'), JSON.stringify({
        generatedAt: new Date().toISOString(),
        uniqueUrls: urls.length,
        recordLinks: tasks.length,
        byFinalStatus: byStatus,
        edgeAttribution: byEdge,
        transportErrors: byError,
        note: 'Body excerpts are contact-sanitized with the shared-key scheme; set-cookie headers are stripped.'
      }, null, 2) + '\n', 'utf8')
    ]);
    return { byStatus, byEdge, byError };
  };

  let checkpoint = 0;
  await pooled(urls, {
    concurrency,
    keyFn: u => hostOf(u),
    onProgress: (d, t) => { if (d === t || d % 25 === 0) console.log(`evidence ${d}/${t}`); }
  }, async url => {
    let evidence;
    try { evidence = await fetchEvidence(url, { timeoutMs, maxBody }); }
    catch (e) { evidence = { url, dns: null, hops: [], final: null, fallback: null, error: `collector bug: ${e.message}`, ms: 0 }; }
    evidenceByUrl.set(url, evidence);
    attrByUrl.set(url, attributionOf(evidence));
    await fsp.writeFile(transcriptFile(url), renderTranscript(evidence, byUrl.get(url)), 'utf8');
    if (++checkpoint % 25 === 0) await writeIndexFiles();
    return evidence;
  });

  const { byStatus, byEdge, byError } = await writeIndexFiles();
  if (transientSocketErrors) console.log(`(absorbed ${transientSocketErrors} transient socket hang-ups)`);

  console.log('');
  console.log(`final status counts: ${JSON.stringify(byStatus)}`);
  console.log(`edge attribution:   ${JSON.stringify(byEdge)}`);
  console.log(`transport errors:   ${JSON.stringify(byError)}`);
  console.log(`-> ${path.join(path.relative(ROOT, outDir), 'index.csv')} and transcripts/`);
}

if (require.main === module) {
  main().catch(e => { console.error(e && e.stack || e); process.exitCode = 1; });
}

module.exports = {
  MANUAL_FINDINGS,
  urlsForRow,
  fetchEvidence,
  attributionOf,
  sanitizeBodyText,
  renderableHeaders,
  renderTranscript
};
