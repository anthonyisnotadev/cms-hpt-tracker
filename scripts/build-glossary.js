#!/usr/bin/env node
/**
 * Generates the glossary at the foot of each explainer page.
 *
 * The explainer pages are written for someone who already knows what a payer
 * is. This file is the other half of that bargain: one plain-English sentence
 * for every piece of jargon those pages use, written once here and rendered
 * into each page that needs it.
 *
 * The contract, which is the same one the source lists already use:
 *
 *   in the prose   <a class="gl" href="#g-chargemaster">chargemaster</a>
 *   at the foot    <div id="g-chargemaster"><dt>..</dt><dd>..</dd></div>
 *
 * So a term is a real anchor to a real definition. It works with JavaScript
 * off, in a reader view and on paper; js/docs.js only adds a hover panel that
 * reads the very same <dd>.
 *
 * This script scans each page for the slugs it actually links to and emits
 * exactly those entries, alphabetically. Nothing is maintained by hand, a
 * mistyped slug fails the build rather than shipping a dead link, and an entry
 * that no page uses is reported so the dictionary does not silently rot.
 *
 * Run via `npm run build`. Rewrites the pages in place between the sentinels.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGES = ['mrf.html', 'rules.html', 'pointer.html'];

const START = '<!-- glossary:start -->';
const END = '<!-- glossary:end -->';

/* ------------------------------------------------------------------
   The dictionary.

   House rules, because a glossary that needs a glossary is worthless:
   no term may be defined using another undefined term; say what the
   thing IS before saying what it is for; and where a word means
   something ordinary in English and something specific here, say so.
   ------------------------------------------------------------------ */
const TERMS = {
  /* ---- the file itself ---- */
  'mrf': {
    term: 'Machine-readable file (MRF)',
    def: 'The one big file every hospital has to publish, listing every price it charges. ' +
         '&ldquo;Machine-readable&rdquo; only means a computer can read it without a person retyping ' +
         'anything: a spreadsheet-like file, not a PDF and not a scan.'
  },
  'standard-charge': {
    term: 'Standard charge',
    def: 'CMS&rsquo;s umbrella word for <em>all five</em> kinds of price a hospital must publish for ' +
         'every item: the list price, the cash price, the price agreed with each insurer, and the ' +
         'lowest and highest of those agreed prices. There is no single &ldquo;the price&rdquo;.'
  },
  'chargemaster': {
    term: 'Chargemaster',
    def: 'The hospital&rsquo;s own master price list, with a list price for every single thing it can ' +
         'bill for. Almost nobody pays these prices; they are the starting point everything else is ' +
         'discounted down from.'
  },
  'gross-charge': {
    term: 'Gross charge',
    def: 'The list price, before anybody&rsquo;s discount. The number off the chargemaster.'
  },
  'cash-price': {
    term: 'Discounted cash price',
    def: 'The price for someone paying out of their own pocket rather than through insurance. It is ' +
         'often far lower than the list price, and sometimes lower than an insured patient&rsquo;s ' +
         'share.'
  },
  'negotiated-charge': {
    term: 'Negotiated charge',
    def: 'The price one hospital and one insurer privately agreed for one item. Historically a trade ' +
         'secret on both sides; prising these into the open is the point of the whole rule.'
  },
  'de-identified': {
    term: 'De-identified minimum and maximum',
    def: 'The lowest and the highest price a hospital has agreed with <em>anyone</em> for an item, ' +
         'published without saying which insurer got which. It shows how wide the spread is without ' +
         'naming names.'
  },
  'allowed-amount': {
    term: 'Allowed amount',
    def: 'What the hospital actually ended up being paid, as opposed to what it charged or what the ' +
         'contract says it should get. The insurer&rsquo;s payment plus the patient&rsquo;s share.'
  },
  'methodology': {
    term: 'Methodology',
    def: 'How a price was arrived at rather than what it is: a flat fee, a rate per day, a rate for a ' +
         'whole case, a percentage of the bill, or &ldquo;other&rdquo;. CMS allows exactly those five ' +
         'answers.'
  },

  /* ---- who is paying ---- */
  'payer': {
    term: 'Payer',
    def: 'Whoever actually pays the hospital. Usually an insurance company, sometimes a government ' +
         'programme such as Medicare, sometimes the patient.'
  },
  'plan': {
    term: 'Plan',
    def: 'One specific insurance product sold by one payer. The same insurer can sell a dozen plans, ' +
         'and each can have agreed a different price with the same hospital for the same procedure. ' +
         'This is why the files get so large.'
  },

  /* ---- codes and clinical shorthand ---- */
  'cpt': {
    term: 'CPT and HCPCS codes',
    def: 'National numbering systems for medical procedures, so that &ldquo;chest CT without ' +
         'contrast&rdquo; is the same code on every bill in the country. CPT covers procedures; HCPCS ' +
         'adds drugs, supplies and equipment.'
  },
  'drg': {
    term: 'DRG and MS-DRG',
    def: 'A code for a whole hospital stay rather than a single procedure - a category such as ' +
         '&ldquo;heart failure, with complications&rdquo; that Medicare pays one flat amount for, ' +
         'however many things happened during it.'
  },
  'modifier': {
    term: 'Modifier',
    def: 'A short code attached to a procedure code to say something was different: which side of the ' +
         'body, that it was done twice, that it was harder than usual. Modifiers change the price, ' +
         'which is why the file has to list them.'
  },
  'setting': {
    term: 'Inpatient and outpatient',
    def: 'Inpatient means you were formally admitted and stayed. Outpatient means you went home the ' +
         'same day. The identical procedure routinely costs different amounts in each.'
  },
  'remittance': {
    term: 'Remittance advice (EDI 835)',
    def: 'The standard electronic statement an insurer sends a hospital after a claim, setting out what ' +
         'it paid and why. It is the hospital&rsquo;s own record of what it was really paid, which is ' +
         'why CMS makes it the source for the allowed-amount figures.'
  },
  'percentile': {
    term: 'Median, 10th and 90th percentile',
    def: 'Ways of describing a spread of numbers. The median is the middle value; the 10th and 90th ' +
         'percentiles sit near the bottom and top of the range. Reported together they show whether ' +
         'payments cluster tightly or vary enormously - which one average number hides.'
  },

  /* ---- identifiers ---- */
  'npi': {
    term: 'NPI',
    abbr: true,
    def: 'National Provider Identifier: a ten-digit number identifying a healthcare provider. A ' +
         '&ldquo;type 2&rdquo; NPI identifies an organisation, such as a hospital, rather than a person.'
  },
  'ein': {
    term: 'EIN',
    abbr: true,
    def: 'Employer Identification Number: the tax number the IRS issues to a business. CMS requires it ' +
         'at the front of the price file&rsquo;s filename, so you can tell who published a file from ' +
         'its name alone.'
  },
  'ccn': {
    term: 'CCN',
    abbr: true,
    def: 'CMS Certification Number: the identifier Medicare uses for a hospital. It is how this tracker ' +
         'tells apart the several hospitals in the country sharing a name.'
  },
  'licence': {
    term: 'Hospital licence',
    def: 'The permit a state issues that lets a building operate as a hospital. The rule attaches to ' +
         'the licence rather than to the building, which is why one filing can cover several sites.'
  },

  /* ---- the rulebook ---- */
  'cms': {
    term: 'CMS',
    abbr: true,
    def: 'The Centers for Medicare &amp; Medicaid Services: the federal agency that writes these rules, ' +
         'checks them, and issues the fines.'
  },
  'cfr': {
    term: '45 CFR Part 180',
    def: 'The Code of Federal Regulations is the published rulebook of the US government, split into ' +
         'numbered titles and parts. Title 45, Part 180 is the hospital price transparency rule; ' +
         '&ldquo;&sect;&nbsp;180.50&rdquo; is one numbered section inside it.'
  },
  'statute': {
    term: 'PHS Act &sect; 2718(e)',
    def: 'The sentence of federal law, added by the Affordable Care Act, that requires hospitals to ' +
         'publish a list of their charges each year. The CMS rule is the detailed machinery for ' +
         'carrying out that one sentence.'
  },
  'federal-register': {
    term: 'Federal Register',
    def: 'The US government&rsquo;s daily journal of record, where every new rule appears first. A ' +
         'citation like &ldquo;88&nbsp;FR&nbsp;82184&rdquo; is volume 88, page 82184 of it.'
  },
  'opps': {
    term: 'OPPS/ASC final rule',
    def: 'The large Medicare payment regulation CMS issues each November, setting what it pays ' +
         'hospitals for outpatient care. CMS uses it as the vehicle for amending the price ' +
         'transparency rules, which is why they change every year.'
  },
  'template': {
    term: 'CMS template',
    def: 'Since July 2024 a hospital may not invent its own layout. CMS publishes the exact columns, in ' +
         'an exact order, with exact names, and every file has to match. Before that, every file was ' +
         'compliant and no two were comparable.'
  },
  'data-dictionary': {
    term: 'Data dictionary',
    def: 'The document listing every column in the CMS template, what belongs in it, and which values ' +
         'are legal. It is the specification a file is judged against.'
  },
  'attestation': {
    term: 'Attestation',
    def: 'A named senior officer of the hospital stating, inside the file itself, that what it contains ' +
         'is true and complete. From 2026 it replaced an unsigned &ldquo;affirmation&rdquo;, so there ' +
         'is now a person attached to the claim.'
  },
  'shoppable': {
    term: 'Shoppable services',
    def: 'Around 300 common services you can plan ahead for - an MRI, a birth, a hip replacement. ' +
         'Hospitals must display prices for these in a plain, consumer-facing way. That is a ' +
         '<em>separate</em> duty from the big machine-readable file, and this tracker does not measure ' +
         'it.'
  },
  'cmp': {
    term: 'Civil monetary penalty',
    def: 'A fine imposed by a federal agency directly, without going to court. The hospital can appeal ' +
         'to an administrative judge.'
  },
  'cap': {
    term: 'Corrective action plan',
    def: 'A written plan a hospital submits to CMS saying how, and by when, it will fix a violation. ' +
         'CMS asks for one before it fines anybody, which is why warnings vastly outnumber penalties.'
  },
  'deemed': {
    term: 'Deemed compliant',
    def: 'Treated as compliant without being examined. Certain federally run facilities are deemed ' +
         'compliant with this rule, so their absence from a price file is not a breach.'
  },
  'validator': {
    term: 'Validator',
    def: 'CMS&rsquo;s own free tool that opens a price file and reports every place it breaks the ' +
         'template&rsquo;s rules. It checks the <em>file</em>; this tracker checks only whether a file ' +
         'can be found and fetched at all.'
  },

  /* ---- the web plumbing ---- */
  'pointer': {
    term: 'Pointer file (cms-hpt.txt)',
    def: 'A small text file at a fixed, predictable web address that says where a hospital&rsquo;s ' +
         'price file actually is. It exists so that nobody - and no program - has to search ' +
         'the website to find one.'
  },
  'robots': {
    term: 'robots.txt',
    def: 'A long-standing web convention: a plain text file at the root of a site telling automated ' +
         'visitors what they may and may not fetch. The pointer file borrows its design wholesale.'
  },
  'well-known': {
    term: '/.well-known/',
    def: 'A folder name reserved by web standards for files meant for machines rather than people. Not ' +
         'where CMS asked for the pointer file, but where enough hospitals put it that this audit looks ' +
         'there too.'
  },
  'crawler': {
    term: 'Crawler',
    def: 'A program that fetches web pages automatically, the way a search engine does. This audit is ' +
         'one, which is why some hospital websites turn it away.'
  },
  'range-request': {
    term: 'Range request',
    def: 'Asking a web server for only the first few kilobytes of a file instead of the whole thing. It ' +
         'is how this audit reads the top of a 164&nbsp;MB price file without downloading 164&nbsp;MB.'
  },
  'cdn': {
    term: 'CDN',
    abbr: true,
    def: 'A network of servers placed in front of a website to make it fast and to absorb attacks. ' +
         'Many treat any automated visitor as an attack, which is a common reason a hospital is marked ' +
         'blocked here rather than failing.'
  },
  'http-status': {
    term: '403 and 429',
    def: 'Numeric answers from a web server. 403 means &ldquo;refused&rdquo;; 429 means &ldquo;you are ' +
         'asking too often&rdquo;. Either stops an automated check without revealing whether the file ' +
         'was there.'
  },
  'health-system': {
    term: 'Health system',
    def: 'A company owning several hospitals. Systems normally publish one pointer file covering all ' +
         'of their hospitals at once, which is why one file can decide the verdict for dozens of rows ' +
         'in the tracker.'
  }
};

/* ------------------------------------------------------------------ */

function entry(slug) {
  const t = TERMS[slug];
  return '      <div id="g-' + slug + '">\n' +
         '        <dt>' + t.term + '</dt>\n' +
         '        <dd>' + t.def + '</dd>\n' +
         '      </div>';
}

function build() {
  const used = new Set();
  let touched = 0;

  for (const page of PAGES) {
    const file = path.join(ROOT, page);
    const html = fs.readFileSync(file, 'utf8');

    const s = html.indexOf(START);
    const e = html.indexOf(END);
    if (s === -1 && e === -1) {
      console.log('  ' + page.padEnd(14) + 'no glossary');
      continue;
    }
    if (s === -1 || e === -1) throw new Error('only one glossary sentinel found in ' + page);
    if (e < s) throw new Error('glossary sentinels are the wrong way round in ' + page);

    // Only links in the prose count. A slug referenced from inside the
    // generated block itself would make the list self-sustaining.
    const before = html.slice(0, s);
    const after = html.slice(e);
    const slugs = new Set();
    const re = /href="#g-([a-z0-9-]+)"/g;
    let m;
    while ((m = re.exec(before + after)) !== null) slugs.add(m[1]);

    const missing = [...slugs].filter((x) => !TERMS[x]);
    if (missing.length) {
      throw new Error(page + ' links to glossary terms that do not exist: ' + missing.join(', '));
    }
    if (!slugs.size) throw new Error(page + ' has glossary sentinels but links to no terms');

    slugs.forEach((x) => used.add(x));

    // Alphabetical by the term as displayed, not by slug: the reader is
    // scanning the left-hand column, and "NPI" does not sit under "n".
    const order = [...slugs].sort((a, b) =>
      TERMS[a].term.replace(/[^A-Za-z0-9 ]/g, '').localeCompare(TERMS[b].term.replace(/[^A-Za-z0-9 ]/g, ''))
    );

    const block =
      START + '\n' +
      '    <dl class="defs glossary">\n' +
      order.map(entry).join('\n') + '\n' +
      '    </dl>\n' +
      '    ' + END;

    const out = before + block + after.slice(END.length);
    if (out !== html) {
      fs.writeFileSync(file, out);
      touched++;
    }
    console.log('  ' + page.padEnd(14) + order.length + ' terms');
  }

  const orphans = Object.keys(TERMS).filter((k) => !used.has(k));
  if (used.size && orphans.length) console.log('  unused entries: ' + orphans.join(', '));
  console.log('glossary: ' + touched + ' page(s) rewritten');
}

if (require.main === module) {
  try {
    build();
  } catch (err) {
    console.error('glossary build failed: ' + err.message);
    process.exit(1);
  }
}

module.exports = { TERMS, build };
