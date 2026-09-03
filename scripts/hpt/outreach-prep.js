#!/usr/bin/env node
'use strict';
/**
 * Build an outreach DRAFT QUEUE from the compliance findings.
 *
 *   node scripts/hpt/outreach-prep.js [options]
 *
 * For every hospital in cms_data/hpt/compliance.csv with an actionable finding
 * (stale file, old template, dead MRF link, no cms-hpt.txt, pointer with no
 * mrf-url), this:
 *
 *   1. classifies the finding into an email variant                (deterministic)
 *   2. fetches the hospital's price page + a couple of contact pages and asks a
 *      model for the best billing / price-transparency email        (LLM + mailto scrape)
 *   3. renders a draft email from the outreach template, with the one
 *      finding-specific paragraph optionally rewritten by the model  (template + LLM)
 *
 * Output: cms_data/hpt/outreach_queue.csv  - one row per hospital, ready to
 * read, edit, and hand to the `outreach` skill.
 *
 * WHAT THIS DOES NOT DO, BY DESIGN:
 *   - it never sends email
 *   - it never writes cms_data/outreach.json (the outreach skill does that,
 *     after you confirm each write)
 *   - the discovered contact name never goes in a salutation; drafts open with
 *     "Hello," per the outreach skill's redaction rule. The name is in the
 *     queue's to_* columns only, for you to place if you choose.
 *
 * Runs without an API key: contact falls back to the first mailto on the
 * hospital's own domain, and the draft paragraph falls back to the template.
 *
 * Options
 *   --limit N            only the first N hospitals (trial run)
 *   --findings a,b       restrict to these variants
 *                        (stale, old-template, broken-link, no-pointer, pointer-no-mrf)
 *   --concurrency N      parallel workers (default 4)
 *   --timeout MS         per page-fetch timeout (default 20000)
 *   --llm-timeout MS     per model-call timeout (default 90000; DeepSeek is slow)
 *   --no-llm-draft       template paragraph only, skip the rewrite call
 *   --retry              re-process hospitals already in the cache
 *   --model NAME         override OPENROUTER_MODEL for this run
 *   --name / --email / --url   signature block
 *                        (or env HPT_OUTREACH_NAME / _EMAIL / _URL)
 *   --audit-dir DIR      where compliance.csv / manifest.json / mrf_dates.json
 *                        live (default cms_data/hpt). The queue and cache are
 *                        always written next to compliance.csv.
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

const { csvToObjects, toCSV, hostOf, JsonStore, pooled } = require('./lib/util');
const { directGet } = require('./lib/fetch');
const { chatJson } = require('./lib/openrouter');

const DEFAULT_DIR = path.join(ROOT_DIR, 'cms_data', 'hpt');
/** Resolved from --audit-dir in main(); every input and output path hangs off it. */
let F = filesIn(DEFAULT_DIR);
function filesIn(dir) {
  return {
    dir,
    compliance: path.join(dir, 'compliance.csv'),
    manifestJson: path.join(dir, 'manifest.json'),
    dates: path.join(dir, 'mrf_dates.json'),
    cache: path.join(dir, 'outreach_prep.json'),
    queue: path.join(dir, 'outreach_queue.csv')
  };
}

const SIG = {
  name: process.env.HPT_OUTREACH_NAME || 'Anthony',
  email: process.env.HPT_OUTREACH_EMAIL || 'mrf-tracker@anthonyisnota.dev',
  url: process.env.HPT_OUTREACH_URL || 'mrf.anthonyisnota.dev'
};

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
const num = (v, d) => (v === undefined ? d : Number(v));
const log = (...m) => console.log(...m);

/* --------------------------------------------------------------- classify -- */

// compliance.csv `finding` -> our email variant. Anything not here is skipped:
// compliant-*, not-assessed-*, federal, and the domain-unknown gap (that is a
// discovery problem, not an outreach one).
const VARIANT_BY_FINDING = {
  'mrf-stale-over-365-days': 'stale',
  'old-template-version': 'old-template',
  'mrf-url-unreachable': 'broken-link',
  'no-cms-hpt-txt-published': 'no-pointer',
  'pointer-lists-no-mrf-url': 'pointer-no-mrf'
};

const SUBJECT = {
  stale: h => `Outdated standard charges file for ${h}`,
  'old-template': h => `Standard charges file template version for ${h}`,
  'broken-link': h => `Broken standard charges file link for ${h}`,
  'no-pointer': h => `Missing cms-hpt.txt for ${h}`,
  'pointer-no-mrf': h => `cms-hpt.txt is missing an mrf-url for ${h}`
};

/** The finding-specific middle paragraph. Also the fallback when the LLM rewrite is off or rejected. */
function templateParagraph(variant, job) {
  const name = job.hospital_name;
  const mrf = job.mrf_url;
  switch (variant) {
    case 'stale':
      return `I'm doing some research into hospital price transparency compliance and noticed ${name}'s standard charges file is dated ${job.mrf_last_updated_raw || job.mrf_last_updated}${job.mrf_days_since_update ? ` (${job.mrf_days_since_update} days old)` : ''}, both the file linked from your price transparency page and the one referenced in cms-hpt.txt:\n\n${mrf}`;
    case 'old-template':
      return `I'm doing some research into hospital price transparency compliance and noticed ${name}'s standard charges file declares CMS template version ${job.cms_template_version || '(pre-3.x)'}. The current schema is 3.x, and some tools stop parsing older versions:\n\n${mrf}`;
    case 'broken-link':
      return `I'm doing some research into hospital price transparency compliance and noticed the standard charges file link for ${name} is not resolving (${job.evidence || 'the file URL returns an error'}), both from your price transparency page and from cms-hpt.txt:\n\n${mrf}`;
    case 'no-pointer':
      return `I'm doing some research into hospital price transparency compliance and could not find a cms-hpt.txt file for ${name}${job.domain ? ` at ${job.domain}/cms-hpt.txt or ${job.domain}/.well-known/cms-hpt.txt` : ''}. That small text file is what points automated tools to your machine-readable standard charges file.`;
    case 'pointer-no-mrf':
      return `I'm doing some research into hospital price transparency compliance and noticed the cms-hpt.txt file${job.domain ? ` at ${job.domain}` : ''} names ${name} but has no mrf-url line linking to its machine-readable standard charges file.`;
    default:
      return `I'm doing some research into hospital price transparency compliance and had a question about ${name}'s standard charges file.`;
  }
}

const FOLLOWUP = "I'll plan to follow up in 30 days so I can continue my research, but would appreciate it if this could get updated before then. Happy to help however's useful!";

/** Assemble the full body and lint it against the outreach skill's hard rules. */
function renderDraft(paragraph) {
  let body = [
    'Hello,',
    '',
    paragraph.trim(),
    '',
    FOLLOWUP,
    '',
    'Thanks so much,',
    SIG.name,
    SIG.email,
    SIG.url
  ].join('\n');

  // No em dashes in drafted email text (outreach skill). Swap for a comma.
  body = body.replace(/\s*-\s*/g, ', ');

  const problems = [];
  if (/^\s*Hi\s+[A-Z][a-z]+,/m.test(body)) problems.push('name-salutation');
  if (!/^Hello,/.test(body)) problems.push('missing-hello');
  if (!body.includes('follow up in 30 days')) problems.push('missing-followup');
  if (body.includes('-')) problems.push('em-dash');
  return { body, problems };
}

/* ---------------------------------------------------------------- contact -- */

const CONTACT_SCHEMA = {
  name: 'hospital_contact', strict: true,
  schema: {
    type: 'object',
    properties: {
      email: { type: 'string', description: 'best contact address, copied exactly, or "" if none present' },
      role: { type: 'string', enum: ['price-transparency', 'patient-financial-services', 'billing', 'compliance', 'general', 'none'] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      evidence: { type: 'string', description: 'the label or sentence the address appeared next to' }
    },
    required: ['email', 'role', 'confidence', 'evidence'],
    additionalProperties: false
  }
};

const CONTACT_SYSTEM = `You extract the single best email address to contact a US hospital about its published price-transparency / standard-charges file.

Recipient priority, best first:
1. a price transparency / standard charges inbox
2. patient financial services / patient accounts / patient billing
3. the hospital compliance office
4. a general "contact us" inbox, only if nothing above is present

Rules:
- Only return an address that literally appears in the material below. Never construct, complete, or guess one.
- Prefer an address on the hospital's own web domain over a generic provider (gmail, yahoo).
- If the only contact route is a web form or a phone number, return email "" and role "none".
- evidence: quote the nearby label or sentence (max ~15 words).`;

function visibleText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function mailtosFrom(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/mailto:([^"'?>\s]+)/gi)) {
    const e = m[1].toLowerCase().replace(/%40/g, '@');
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

function linksFrom(html, base) {
  const abs = u => { try { return new URL(u, base).toString(); } catch (_e) { return ''; } };
  const out = [];
  const re = /<a\b[^>]*\bhref=["']([^"'#>\s][^"'>\s]*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 400) {
    const href = abs(m[1]);
    if (!href) continue;
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    out.push({ href, text });
  }
  return out;
}

const CONTACT_HINT = /contact|billing|financial|patient[-_ ]?account|customer[-_ ]?service|price[-_ ]?transparen|about[-_ ]?us/i;

// Rank scraped mailto: addresses so the deterministic fallback (and a tie-break
// on the model's own list) prefers a billing / price-transparency mailbox over
// a portal-support, medical-records, or generic info inbox.
const GOOD_LOCALPART = /^(billing|billpay|bill|pfs|pfr|patient[-_.]?account|patient[-_.]?financial|patient[-_.]?billing|financial|finance|price|pricing|charges|standardcharges|transparency|revenue|rev[-_.]?cycle|compliance)/i;
const BAD_LOCALPART = /^(support|info|help|hello|contact|no-?reply|do-?not-?reply|webmaster|admin|marketing|media|press|news|careers|jobs|recruit|hr|volunteer|foundation|donate|giving|mychart|portal|medicalrecords|him\b|records|scheduling|appointment|referral)/i;

function rankMailtos(list, domain) {
  const d = domain ? domain.replace(/^www\./, '') : '';
  const score = e => {
    const local = (e.split('@')[0] || '');
    let s = 0;
    if (d && e.endsWith('@' + d)) s += 4;
    if (GOOD_LOCALPART.test(local)) s += 3;
    if (BAD_LOCALPART.test(local)) s -= 3;
    return s;
  };
  return [...list].sort((a, b) => score(b) - score(a));
}

/**
 * Gather contact candidates for one hospital: its price page, its homepage, a
 * couple of obvious contact URLs, and one hop to whatever contact/billing link
 * the homepage advertises. Returns page text + every mailto seen, then (if a
 * key is set) a model's pick.
 */
async function findContact(job, opt) {
  const timeoutMs = num(opt.timeout, 20000);          // page fetch
  const llmTimeoutMs = num(opt['llm-timeout'], 90000); // model call (DeepSeek runs slow)
  const domain = job.domain || hostOf(job.source_page_url);
  const seeds = [];
  if (job.source_page_url) seeds.push(job.source_page_url);
  if (domain) {
    seeds.push(`https://${domain}/`, `https://${domain}/contact`, `https://${domain}/contact-us`);
  }

  const seen = new Set();
  const pages = [];
  const allMailtos = new Set();
  const queue = [...new Set(seeds)];
  let hops = 0;

  while (queue.length && pages.length < (num(opt.maxPages, 5))) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const r = await directGet(url, { timeoutMs });
    if (!r.body) continue;
    for (const e of mailtosFrom(r.body)) allMailtos.add(e);
    pages.push({ url: r.finalUrl || url, text: visibleText(r.body).slice(0, 3500), mailtos: mailtosFrom(r.body) });

    // One hop: follow a contact/billing link found on the first (price/home) page.
    if (hops < 1 && domain) {
      hops++;
      for (const l of linksFrom(r.body, r.finalUrl || url)) {
        if (queue.length > 4) break;
        if (hostOf(l.href) === hostOf(url) && CONTACT_HINT.test(l.href + ' ' + l.text) && !seen.has(l.href)) {
          queue.push(l.href);
        }
      }
    }
  }

  const mailtoList = [...allMailtos];
  const onDomain = mailtoList.filter(e => domain && e.endsWith('@' + domain.replace(/^www\./, '')));

  let pick = null;
  if (process.env.OPENROUTER_API_KEY && pages.length) {
    // Fold the mailto: addresses into each page's text -- visibleText() strips
    // <a href="mailto:"> markup, so otherwise the model is told an address is
    // "not in the material" when it is right there in a link.
    const rendered = pages.map(p => {
      const emails = p.mailtos.length ? `\nEMAIL ADDRESSES LINKED ON THIS PAGE: ${p.mailtos.join(', ')}` : '';
      return `PAGE: ${p.url}${emails}\nTEXT: ${p.text}`;
    }).join('\n\n');
    const res = await chatJson({
      system: CONTACT_SYSTEM,
      user: `Hospital: ${job.hospital_name} - ${job.city}, ${job.state}\nWeb domain: ${domain || '(unknown)'}\n\n${rendered}`,
      schema: CONTACT_SCHEMA, model: opt.model, timeoutMs: llmTimeoutMs
    });
    if (res.data && res.data.email) {
      // Trust the model only if the address it returned actually appeared.
      const e = String(res.data.email).toLowerCase();
      if (mailtoList.includes(e) || pages.some(p => p.text.toLowerCase().includes(e))) {
        pick = { email: e, role: res.data.role || 'general', confidence: res.data.confidence || 'low', evidence: (res.data.evidence || '').slice(0, 160) };
      }
    }
  }
  if (!pick) {
    // Ranked fallback: billing/PFS mailbox on the hospital's own domain first.
    const ranked = rankMailtos(mailtoList, domain);
    const e = ranked[0] || '';
    const local = e.split('@')[0] || '';
    pick = {
      email: e,
      role: e ? (GOOD_LOCALPART.test(local) ? 'billing' : 'general') : 'none',
      confidence: e ? (GOOD_LOCALPART.test(local) && onDomain.includes(e) ? 'medium' : 'low') : 'none',
      evidence: e
        ? `scraped mailto: link (${GOOD_LOCALPART.test(local) ? 'billing-type mailbox' : 'best available'}${onDomain.includes(e) ? ', on hospital domain' : ''}; no model pick)`
        : 'no email address found on the pages checked'
    };
  }

  return {
    ...pick,
    pagesChecked: pages.map(p => p.url).join(' | '),
    mailtosSeen: mailtoList.join(' ')
  };
}

/* ------------------------------------------------------------------ draft -- */

const PARA_SCHEMA = {
  name: 'draft_paragraph', strict: true,
  schema: {
    type: 'object',
    properties: { paragraph: { type: 'string' }, note: { type: 'string' } },
    required: ['paragraph', 'note'],
    additionalProperties: false
  }
};

const PARA_SYSTEM = `You rewrite ONE paragraph of a short, low-key outreach email to a US hospital about its price-transparency file.

Keep it to 1-3 plain sentences. State only the finding and, if given, the file URL on its own line.
Do NOT: add urgency, cite CMS enforcement or deadlines, speculate about why the hospital is behind, add a greeting or sign-off, or use an em dash (use a comma or a new sentence).
Return the paragraph text only, no "Dear ...", no "Thanks".`;

async function draftParagraph(variant, job, opt) {
  const base = templateParagraph(variant, job);
  if (opt['no-llm-draft'] || !process.env.OPENROUTER_API_KEY) return { paragraph: base, source: 'template' };

  const facts = [
    `hospital: ${job.hospital_name} (${job.city}, ${job.state})`,
    `finding: ${job.finding}`,
    job.evidence ? `evidence: ${job.evidence}` : '',
    job.mrf_last_updated ? `file last_updated_on: ${job.mrf_last_updated_raw || job.mrf_last_updated} (${job.mrf_days_since_update} days old)` : '',
    job.cms_template_version ? `template version: ${job.cms_template_version}` : '',
    job.mrf_url ? `file url: ${job.mrf_url}` : '',
    job.domain ? `domain: ${job.domain}` : ''
  ].filter(Boolean).join('\n');

  const res = await chatJson({
    system: PARA_SYSTEM,
    user: `Rewrite this paragraph using the facts below. Keep the file URL on its own line if present.\n\nFACTS:\n${facts}\n\nCURRENT PARAGRAPH:\n${base}`,
    schema: PARA_SCHEMA, model: opt.model, timeoutMs: num(opt['llm-timeout'], 90000)
  });

  const p = res.data && typeof res.data.paragraph === 'string' ? res.data.paragraph.trim() : '';
  const noWs = s => String(s).replace(/\s+/g, '');
  // Reject a rewrite that broke a house rule or dropped the file URL. The URL
  // check is whitespace-insensitive: the model often reflows a long URL.
  const bad = !p
    || p.includes('-')
    || /\b(dear|hello|hi|thanks|thank you|regards|sincerely|best regards)\b/i.test(p)
    || (job.mrf_url && !noWs(p).includes(noWs(job.mrf_url)));
  if (bad) return { paragraph: base, source: res.error ? `template (llm ${res.error.slice(0, 40)})` : 'template-fallback' };
  return { paragraph: p, source: 'llm' };
}

/* ------------------------------------------------------------------- main -- */

async function main() {
  const opt = parseArgs();
  if (opt.help || opt.h) {
    const doc = fs.readFileSync(__filename, 'utf8');
    const block = doc.slice(doc.indexOf('/**') + 3, doc.indexOf('*/'));
    log(block.replace(/^ \* ?/gm, '').trim());
    return;
  }
  if (opt.name) SIG.name = opt.name;
  if (opt.email) SIG.email = opt.email;
  if (opt.url) SIG.url = opt.url;
  if (opt['audit-dir']) F = filesIn(path.resolve(String(opt['audit-dir'])));

  let compliance;
  try {
    compliance = csvToObjects(await fsp.readFile(F.compliance, 'utf8'));
  } catch (_e) {
    log(`Cannot read ${path.relative(ROOT_DIR, F.compliance)} -- run: node scripts/hpt/run.js compliance`);
    process.exitCode = 1;
    return;
  }
  let manifest = [];
  try { manifest = JSON.parse(await fsp.readFile(F.manifestJson, 'utf8')); } catch (_e) {}
  let dates = {};
  try { dates = JSON.parse(await fsp.readFile(F.dates, 'utf8')); } catch (_e) {}
  const rowByCcn = new Map(manifest.map(r => [r.ccn, r]));

  const onlyVariants = opt.findings
    ? new Set(String(opt.findings).split(',').map(s => s.trim()).filter(Boolean))
    : null;

  let jobs = [];
  for (const c of compliance) {
    const variant = VARIANT_BY_FINDING[c.finding];
    if (!variant) continue;
    if (onlyVariants && !onlyVariants.has(variant)) continue;
    const mrow = rowByCcn.get(c.ccn) || {};
    const probe = mrow.mrf_url ? dates[mrow.mrf_url] : null;
    jobs.push({
      variant,
      ccn: c.ccn,
      hospital_name: c.hospital_name,
      city: c.city,
      state: c.state,
      domain: c.domain || mrow.domain || '',
      finding: c.finding,
      evidence: c.evidence,
      mrf_url: c.mrf_url || mrow.mrf_url || '',
      source_page_url: mrow.source_page_url || '',
      mrf_last_updated: c.mrf_last_updated || mrow.mrf_last_updated || '',
      mrf_last_updated_raw: (probe && probe.declaredRaw) || mrow.mrf_last_updated_raw || '',
      mrf_days_since_update: c.mrf_days_since_update || mrow.mrf_days_since_update || '',
      cms_template_version: c.cms_template_version || mrow.mrf_cms_version || ''
    });
  }

  const cache = new JsonStore(F.cache);
  await cache.load();
  const pending = jobs.filter(j => opt.retry || !cache.has(j.ccn));
  if (opt.limit) pending.splice(num(opt.limit));

  log(`${jobs.length} hospitals with an actionable finding; ${pending.length} to process (cached: ${cache.size}).`);
  if (!process.env.OPENROUTER_API_KEY) log('OPENROUTER_API_KEY not set -- contact = first on-domain mailto, draft = template only.');
  if (!pending.length && !jobs.length) return;

  let done = 0, withEmail = 0, saveCounter = 0;
  if (pending.length) {
    await pooled(pending, {
      concurrency: num(opt.concurrency, 4),
      keyFn: j => j.domain || j.ccn,
      onProgress: (d, t) => {
        if (process.stdout.isTTY) process.stdout.write(`\rprepping ${d}/${t}  email=${withEmail}`.padEnd(60));
        else if (d % 25 === 0 || d === t) log(`prepping ${d}/${t}  email=${withEmail}`);
      }
    }, async (job) => {
      let contact, para;
      try {
        contact = await findContact(job, opt);
      } catch (e) {
        contact = { email: '', role: 'none', confidence: 'none', evidence: `error: ${String((e && e.message) || e).slice(0, 120)}`, pagesChecked: '', mailtosSeen: '' };
      }
      try {
        para = await draftParagraph(job.variant, job, opt);
      } catch (_e) {
        para = { paragraph: templateParagraph(job.variant, job), source: 'template-fallback' };
      }
      const draft = renderDraft(para.paragraph);
      if (contact.email) withEmail++;
      cache.set(job.ccn, {
        ...job,
        to_email: contact.email,
        to_role: contact.role,
        to_confidence: contact.confidence,
        to_evidence: contact.evidence,
        contact_pages_checked: contact.pagesChecked,
        mailtos_seen: contact.mailtosSeen,
        subject: (SUBJECT[job.variant] || (h => `Standard charges file for ${h}`))(job.hospital_name),
        body: draft.body,
        draft_source: para.source,
        lint_problems: draft.problems.join(';'),
        prepared_at: new Date().toISOString()
      });
      done++;
      if (++saveCounter % 10 === 0) await cache.save();
    });
    await cache.save(true);
    if (process.stdout.isTTY) log('');
  }

  // Emit the full queue (every cached job, not just this run's).
  const COLS = [
    'ccn', 'hospital_name', 'city', 'state', 'domain', 'finding', 'variant',
    'to_email', 'to_role', 'to_confidence', 'to_evidence',
    'contact_pages_checked', 'mailtos_seen',
    'subject', 'body', 'draft_source', 'lint_problems',
    'mrf_url', 'source_page_url', 'mrf_last_updated', 'mrf_days_since_update', 'cms_template_version'
  ];
  const rows = Object.values(cache.data)
    .sort((a, b) => (a.state || '').localeCompare(b.state || '') || (a.hospital_name || '').localeCompare(b.hospital_name || ''));
  await fsp.writeFile(F.queue, toCSV(rows, COLS));

  const byVariant = {};
  const noEmail = rows.filter(r => !r.to_email).length;
  const linted = rows.filter(r => r.lint_problems).length;
  for (const r of rows) byVariant[r.variant] = (byVariant[r.variant] || 0) + 1;
  log('');
  log(`queue: ${rows.length} rows  ${JSON.stringify(byVariant)}`);
  log(`  with a contact email:     ${rows.length - noEmail}`);
  log(`  NO contact email found:   ${noEmail}  (needs a manual look)`);
  if (linted) log(`  draft failed a lint rule: ${linted}  (check the lint_problems column)`);
  log(`-> ${path.relative(ROOT_DIR, F.queue)}`);
  log('');
  log('Review the drafts, then hand rows to the `outreach` skill to log them.');
  log('This script does not send anything and does not write cms_data/outreach.json.');
}

main().catch(e => { console.error('\nERROR:', (e && e.message) || e); process.exitCode = 1; });
