#!/usr/bin/env node
/* Terminal front-end to the outreach store, built so an LLM can drive it.
 *
 * Two things it does that the HTTP API can't:
 *
 *   1. `find` resolves a hospital name to a CCN against cms_data/hpt/roster.json,
 *      and is honest about ambiguity rather than picking a winner. Free text
 *      ("Evergreen Medical") is what you actually have; CCNs are what the store
 *      is keyed by.
 *
 *   2. `apply` takes a JSON plan of many ops across many CCNs and is DRY RUN BY
 *      DEFAULT. Nothing is written without --commit. One pasted email or one MRF
 *      listing 40 hospitals becomes one plan, one reviewed diff, one write.
 *
 * Run `node scripts/outreach-cli.js help` for usage.
 *
 * No dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./outreach-store');

const ROOT = path.join(__dirname, '..');
const ROSTER_FILE = path.join(ROOT, 'cms_data', 'hpt', 'roster.json');

/* ---------- arg parsing ---------- */

// Flags that take no value; everything else consumes the next token.
const BOOL_FLAGS = new Set(['json', 'commit', 'clear', 'quiet', 'help']);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    if (BOOL_FLAGS.has(key)) { out[key] = true; continue; }
    out[key] = argv[++i];
  }
  return out;
}

function die(msg) {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

/* ---------- hospital name resolution ---------- */

let rosterCache = null;

function roster() {
  if (rosterCache) return rosterCache;
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
  } catch (e) {
    die(`could not read roster ${ROSTER_FILE}: ${e.message}`);
  }
  // Inverse document frequency over the roster's own names, so "hospital",
  // "medical" and "center" fall away on their own and the distinguishing word
  // carries the match. Beats maintaining a stopword list by hand.
  const df = Object.create(null);
  const prepared = rows.map((r) => {
    const toks = tokenize(r.name);
    const uniq = Array.from(new Set(toks));
    uniq.forEach((t) => { df[t] = (df[t] || 0) + 1; });
    return { row: r, toks: new Set(uniq), norm: uniq.join(' '), flat: tokenize(r.name).join(' ') };
  });
  rosterCache = { prepared, df, n: rows.length, byCcn: new Map(rows.map((r) => [r.ccn, r])) };
  return rosterCache;
}

function tokenize(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function looksLikeCcn(s) {
  return /^[0-9]{5,6}[A-Za-z0-9]?$/.test(String(s || '').trim()) && String(s).trim().length <= 6;
}

function resolve(query, opts) {
  opts = opts || {};
  const R = roster();
  const raw = String(query || '').trim();

  if (looksLikeCcn(raw)) {
    const hit = R.byCcn.get(raw) || R.byCcn.get(raw.toUpperCase());
    if (hit) return { query: raw, confidence: 'exact', candidates: [{ ...hit, score: 1 }] };
  }

  const qToks = Array.from(new Set(tokenize(raw)));
  if (!qToks.length) return { query: raw, confidence: 'none', candidates: [] };

  const weight = (t) => Math.log(1 + R.n / (1 + (R.df[t] || 0)));
  const total = qToks.reduce((s, t) => s + weight(t), 0) || 1;
  const qFlat = qToks.join(' ');
  const state = opts.state ? String(opts.state).toUpperCase() : '';
  const city = opts.city ? tokenize(opts.city).join(' ') : '';

  const scored = [];
  for (const p of R.prepared) {
    if (state && p.row.state !== state) continue;
    let matched = 0;
    for (const t of qToks) if (p.toks.has(t)) matched += weight(t);
    // `base` is how much of the query the name accounts for, and it alone
    // decides ambiguity. Bonuses only order the tie — a name that happens to
    // equal the query must not read as unambiguous when four other hospitals
    // contain every query word too ("st marys hospital").
    const base = matched / total;
    if (base <= 0) continue;
    let score = base;
    if (p.flat.includes(qFlat)) score += 0.15;            // whole query appears in order
    if (p.flat === qFlat) score += 0.35;                  // exact name
    if (city && tokenize(p.row.city).join(' ') === city) score += 0.2;
    if (state && p.row.state === state) score += 0.05;
    scored.push({
      ...p.row,
      base: Math.round(base * 1000) / 1000,
      score: Math.round(Math.min(score, 1.5) * 1000) / 1000,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.ccn.localeCompare(b.ccn));
  const limit = Number(opts.limit || 5);
  const candidates = scored.slice(0, limit);
  const fullMatches = scored.filter((c) => c.base >= 0.999).length;

  let confidence = 'none';
  if (candidates.length) {
    const top = candidates[0];
    const second = candidates[1] ? candidates[1].score : 0;
    if (fullMatches > 1) confidence = 'ambiguous';
    else if (fullMatches === 1 && top.base >= 0.999) confidence = 'exact';
    else if (top.score >= 0.7 && top.score - second >= 0.12) confidence = 'high';
    else if (top.score >= 0.5) confidence = 'ambiguous';
    else confidence = 'weak';
  }
  return { query: raw, confidence, fullMatches, candidates };
}

/* ---------- change description ---------- */

const SCALARS = ['name', 'city', 'state', 'status', 'followUpOn'];
const CORRECTION_KEYS = ['domain', 'pointerUrl', 'mrfUrl', 'lastUpdatedOn', 'templateVersion', 'verdict', 'checkedOn', 'note'];
// Stored content of an entry, for diffing one that was edited in place. `id`,
// `kind` and `at` are excluded because none of them can change; `editedAt` is
// bookkeeping the edit itself sets, not something the caller asked for.
const ENTRY_FIELDS = ['subject', 'to', 'body', 'sentAt', 'outcome', 'text'];

function snapshot(rec) {
  return rec ? JSON.parse(JSON.stringify(rec)) : null;
}

function describeChange(before, after) {
  const lines = [];
  if (!before && after) lines.push('NEW record');
  const b = before || {};
  const a = after || {};

  SCALARS.forEach((k) => {
    const bv = b[k] || '';
    const av = a[k] || '';
    if (bv !== av) lines.push(`${k}: ${bv ? `"${bv}"` : '(empty)'} -> ${av ? `"${av}"` : '(empty)'}`);
  });

  const bc = b.correction || null;
  const ac = a.correction || null;
  if (bc && !ac) lines.push('correction: cleared');
  else if (ac) {
    CORRECTION_KEYS.forEach((k) => {
      const bv = (bc && bc[k]) || '';
      const av = ac[k] || '';
      if (bv !== av) lines.push(`correction.${k}: ${bv ? `"${bv}"` : '(empty)'} -> ${av ? `"${av}"` : '(empty)'}`);
    });
  }

  const bIds = new Set((b.entries || []).map((e) => e.id));
  const aIds = new Set((a.entries || []).map((e) => e.id));
  (a.entries || []).forEach((e) => {
    if (bIds.has(e.id)) return;
    const label = e.kind === 'email'
      ? `email "${e.subject}" to ${e.to || '(no recipient)'} sent ${e.sentAt}`
      : `note "${truncate(e.text, 60)}"`;
    lines.push(`+ ${label}`);
  });
  (b.entries || []).forEach((e) => {
    if (!aIds.has(e.id)) lines.push(`- removed ${e.kind} ${e.id}`);
  });
  // Field-level changes to an entry that survived — an outcome flip, or anything
  // edit-entry rewrote. Bodies are truncated: the point is that the field moved,
  // and an 8000-character diff line helps nobody review it.
  (a.entries || []).forEach((e) => {
    const prev = (b.entries || []).find((x) => x.id === e.id);
    if (!prev) return;
    ENTRY_FIELDS.forEach((k) => {
      const bv = String(prev[k] == null ? '' : prev[k]);
      const av = String(e[k] == null ? '' : e[k]);
      if (bv === av) return;
      lines.push(`entry ${e.id} ${k}: ${bv ? `"${truncate(bv, 60)}"` : '(empty)'}`
        + ` -> ${av ? `"${truncate(av, 60)}"` : '(empty)'}`);
    });
  });

  return lines;
}

// "JOINT BASE ELMENDORF-RICHARDSON" -> "Joint Base Elmendorf-Richardson",
// "673RD MEDICAL GROUP" -> "673rd Medical Group".
function titleCase(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .split(/([^a-z0-9']+)/)
    .map((part) => {
      if (!part || /[^a-z0-9']/.test(part) || /^\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

function truncate(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/* ---------- discarded input ---------- */

/* The store builds records and entries field by field rather than spreading, and
 * silently coerces anything malformed: a US-format sentAt becomes today, a
 * bare-path mrfUrl becomes empty, an unknown key vanishes. None of that reaches
 * describeChange(), so the diff looks clean and the review gate — the point of
 * the whole design — has nothing to catch. These two tables let us compare what
 * was sent against what landed and report the difference.
 *
 * Post-hoc comparison, deliberately: outreach-store.js already has to be kept in
 * sync with js/outreach.js by hand, and a third copy of normUrl/normDomain/isDate
 * here would be a third thing to drift. */

// Every write op also accepts the labels, because addEntry and setCorrection
// seed them when blank (only upsert overwrites).
const LABELS = ['name', 'city', 'state'];
const OP_FIELDS = {
  status: ['ccn'].concat(LABELS, ['status', 'followUpOn']),
  upsert: ['ccn'].concat(LABELS, ['status', 'followUpOn']),
  email: ['ccn'].concat(LABELS, ['subject', 'to', 'body', 'sentAt', 'outcome']),
  note: ['ccn'].concat(LABELS, ['text']),
  correction: ['ccn'].concat(LABELS, CORRECTION_KEYS, ['clear']),
  outcome: ['ccn', 'id', 'outcome'],
  'edit-entry': ['ccn', 'id'].concat(ENTRY_FIELDS),
  'delete-entry': ['ccn', 'id'],
  delete: ['ccn'],
};

// Which part of the store's return value a supplied field should have landed in.
const FIELD_TARGET = {
  name: 'record', city: 'record', state: 'record', status: 'record', followUpOn: 'record',
  subject: 'entry', to: 'entry', body: 'entry', sentAt: 'entry', outcome: 'entry', text: 'entry',
  domain: 'correction', pointerUrl: 'correction', mrfUrl: 'correction',
  lastUpdatedOn: 'correction', templateVersion: 'correction', verdict: 'correction',
  checkedOn: 'correction', note: 'correction',
};

// Structural keys that address the write rather than being stored by it.
const STRUCTURAL = new Set(['op', 'ccn', 'id', 'clear']);

function describeDiscards(op, suppliedKeys, res) {
  const out = [];
  const known = OP_FIELDS[op.op] || [];
  const targets = {
    record: res && res.record,
    entry: res && res.entry,
    correction: res && res.correction,
  };

  suppliedKeys.forEach((k) => {
    if (STRUCTURAL.has(k)) return;
    if (known.indexOf(k) === -1) {
      out.push(`unknown field "${k}" — the store has no such field`);
      return;
    }
    var target = targets[FIELD_TARGET[k]];
    // A collapsed correction leaves nothing to compare against, but the fields
    // that were rejected are exactly why it collapsed — compare against empty so
    // the cause is reported alongside the effect.
    if (!target && FIELD_TARGET[k] === 'correction' && op.op === 'correction' && !op.clear) target = {};
    if (!target) return;
    // Trim both sides: the store trims some fields and not others, and a trim is
    // not the kind of loss worth flagging. Truncation and coercion still differ.
    const sent = String(op[k] == null ? '' : op[k]).trim();
    const stored = String(target[k] == null ? '' : target[k]).trim();
    if (sent === stored) return;
    out.push(`${k} ${sent ? `"${truncate(sent, 60)}"` : '(empty)'} -> stored ${stored ? `"${truncate(stored, 60)}"` : 'empty'}`);
  });

  if (op.op === 'correction' && !op.clear && !(res && res.correction)) {
    out.push('the whole correction was dropped — one of domain, pointerUrl, mrfUrl, '
      + 'lastUpdatedOn, templateVersion, verdict or note must be set (checkedOn alone is not enough)');
  }
  return out;
}

/* ---------- plan application ---------- */

const OPS = {
  status: (o) => store.upsert(o),
  upsert: (o) => store.upsert(o),
  email: (o) => store.addEntry({ ...o, kind: 'email' }),
  note: (o) => store.addEntry({ ...o, kind: 'note' }),
  correction: (o) => store.setCorrection(o),
  outcome: (o) => store.setOutcome(o),
  'edit-entry': (o) => store.editEntry(o),
  'delete-entry': (o) => store.deleteEntry(o),
  delete: (o) => store.remove(o),
};

function readPlan(arg) {
  let raw;
  if (arg === '-' || arg == null) raw = fs.readFileSync(0, 'utf8');
  else raw = fs.readFileSync(arg, 'utf8');
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { die(`plan is not valid JSON: ${e.message}`); }
  const ops = Array.isArray(parsed) ? parsed : parsed.ops;
  if (!Array.isArray(ops)) die('plan must be a JSON array of ops, or { "ops": [...] }');
  return ops;
}

function applyPlan(ops, commit) {
  store.load();
  const R = roster();
  const touched = new Map();   // ccn -> before-snapshot
  const problems = [];
  const warnings = [];
  const discarded = [];

  ops.forEach((op, i) => {
    const label = `op ${i + 1} (${op && op.op})`;
    if (!op || !op.op) { problems.push(`${label}: missing "op"`); return; }
    const fn = OPS[op.op];
    if (!fn) { problems.push(`${label}: unknown op "${op.op}" — expected one of ${Object.keys(OPS).join(', ')}`); return; }
    if (!op.ccn) { problems.push(`${label}: missing "ccn"`); return; }
    if (!touched.has(op.ccn)) touched.set(op.ccn, snapshot(store.get(op.ccn)));

    const known = R.byCcn.get(op.ccn);
    if (!known) warnings.push(`${label} [${op.ccn}]: CCN is not in the roster — check it is real`);

    // A record created by a bare correction/email would otherwise land with an
    // empty name, invisible to `list --state` and blank in the tracker UI. The
    // roster already has the labels, so fill them in — title-cased, because the
    // roster stores SHOUTING and the existing records don't.
    // Snapshot the keys before the roster fills any in below, so its title-casing
    // is never reported back as something the caller asked for.
    const suppliedKeys = Object.keys(op);

    const existing = store.get(op.ccn);
    if (known && (!existing || !existing.name)) {
      if (op.name == null) op.name = titleCase(known.name);
      if (op.city == null) op.city = titleCase(known.city);
      if (op.state == null) op.state = known.state;
    }

    try {
      const res = fn(op);
      describeDiscards(op, suppliedKeys, res).forEach((d) => discarded.push(`${label} [${op.ccn}]: ${d}`));
    } catch (e) { problems.push(`${label} [${op.ccn}]: ${e.message}`); }
  });

  if (problems.length) {
    process.stderr.write(`${problems.length} problem(s), nothing written:\n`);
    problems.forEach((p) => process.stderr.write(`  ${p}\n`));
    process.exit(1);
  }

  warnings.forEach((w) => process.stderr.write(`warning: ${w}\n`));
  discarded.forEach((d) => process.stderr.write(`discarded: ${d}\n`));

  const report = [];
  for (const [ccn, before] of touched) {
    const after = store.get(ccn);
    const changes = describeChange(before, after);
    if (!changes.length) continue;
    const known = R.byCcn.get(ccn);
    report.push({ ccn, label: (after && after.name) || (known && known.name) || '(unknown hospital)', changes });
  }

  if (!report.length) {
    process.stdout.write('no changes.\n');
    return;
  }

  process.stdout.write(`${commit ? 'APPLIED' : 'DRY RUN — nothing written'} · ${report.length} record(s)\n\n`);
  report.forEach((r) => {
    process.stdout.write(`  ${r.ccn}  ${r.label}\n`);
    r.changes.forEach((c) => process.stdout.write(`      ${c}\n`));
    process.stdout.write('\n');
  });

  if (commit) {
    store.save();
    process.stdout.write(`written to ${path.relative(ROOT, store.DATA_FILE)} (backup: ${path.relative(ROOT, store.BACKUP_FILE)})\n`);
  } else {
    process.stdout.write('re-run with --commit to write.\n');
  }
}

/* ---------- commands ---------- */

function cmdFind(args) {
  const queries = args.batch
    ? (args.batch === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(args.batch, 'utf8'))
      .split('\n').map((s) => s.trim()).filter(Boolean)
    : [args._.join(' ')];
  if (!queries.length || !queries[0]) die('find needs a name, or --batch <file|->');

  const results = queries.map((q) => resolve(q, { state: args.state, city: args.city, limit: args.limit }));
  if (args.json) { process.stdout.write(`${JSON.stringify(results, null, 2)}\n`); return; }

  results.forEach((r) => {
    process.stdout.write(`"${r.query}" — ${r.confidence}\n`);
    if (!r.candidates.length) process.stdout.write('    no match\n');
    r.candidates.forEach((c, i) => {
      const rec = store.get(c.ccn);
      const tag = rec ? `  [tracked: ${rec.status}]` : '';
      process.stdout.write(`   ${i === 0 ? '*' : ' '} ${c.ccn}  ${c.name} — ${c.city}, ${c.state}  (${c.score})${tag}\n`);
    });
    process.stdout.write('\n');
  });
}

function cmdShow(args) {
  const q = args._.join(' ');
  if (!q) die('show needs a ccn or a name');
  let ccn = q;
  if (!looksLikeCcn(q)) {
    const r = resolve(q, { state: args.state, limit: 1 });
    if (!r.candidates.length) die(`no hospital matches "${q}"`);
    ccn = r.candidates[0].ccn;
  }
  const rec = store.get(ccn);
  if (args.json) { process.stdout.write(`${JSON.stringify(rec, null, 2)}\n`); return; }
  if (!rec) {
    const known = roster().byCcn.get(ccn);
    process.stdout.write(`${ccn} — ${known ? `${known.name} (${known.city}, ${known.state})` : 'unknown'} — no outreach record yet\n`);
    return;
  }
  process.stdout.write(`${rec.ccn}  ${rec.name} — ${rec.city}, ${rec.state}\n`);
  process.stdout.write(`status: ${rec.status}${rec.followUpOn ? `   follow up: ${rec.followUpOn}` : ''}\n`);
  if (rec.correction) {
    process.stdout.write('correction:\n');
    CORRECTION_KEYS.forEach((k) => { if (rec.correction[k]) process.stdout.write(`    ${k}: ${rec.correction[k]}\n`); });
  }
  process.stdout.write(`entries: ${(rec.entries || []).length}\n`);
  (rec.entries || []).forEach((e) => {
    if (e.kind === 'email') process.stdout.write(`    ${e.sentAt}  email  "${e.subject}" -> ${e.to || '(none)'}  [${e.outcome}]  ${e.id}\n`);
    else process.stdout.write(`    ${String(e.at).slice(0, 10)}  note   "${truncate(e.text, 70)}"  ${e.id}\n`);
  });
}

function cmdList(args) {
  let items = store.all();
  if (args.status) items = items.filter((r) => r.status === args.status);
  if (args.state) items = items.filter((r) => r.state === String(args.state).toUpperCase());
  if (args.verdict) items = items.filter((r) => r.correction && r.correction.verdict === args.verdict);
  items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (args.json) { process.stdout.write(`${JSON.stringify(items, null, 2)}\n`); return; }
  process.stdout.write(`${items.length} record(s)\n`);
  items.forEach((r) => {
    const v = r.correction && r.correction.verdict ? `  verdict:${r.correction.verdict}` : '';
    process.stdout.write(`  ${r.ccn}  ${String(r.status).padEnd(14)} ${truncate(r.name, 42).padEnd(42)} ${r.state}  entries:${(r.entries || []).length}${v}\n`);
  });
}

// Single-op sugar: build a one-op plan and run it through the same path.
function cmdSingle(opName, args) {
  const op = { op: opName };
  Object.keys(args).forEach((k) => {
    if (k === '_' || k === 'commit' || k === 'json' || k === 'quiet') return;
    if (k === 'bodyFile' || k === 'body-file') return;
    op[k] = args[k];
  });
  if (!op.ccn && args._.length) op.ccn = args._[0];
  const bodyFile = args['body-file'];
  if (bodyFile) op.body = fs.readFileSync(bodyFile === '-' ? 0 : bodyFile, 'utf8');
  const textFile = args['text-file'];
  if (textFile) op.text = fs.readFileSync(textFile === '-' ? 0 : textFile, 'utf8');
  if (!op.ccn) die(`${opName} needs --ccn (use \`find\` to resolve a name first)`);
  applyPlan([op], !!args.commit);
}

const HELP = `outreach-cli — natural-language-friendly writes to cms_data/outreach.json

READ
  find <name...> [--state XX] [--city C] [--limit N] [--json]
  find --batch <file|-> [--state XX] [--json]      one name per line
  show <ccn|name> [--json]
  list [--status S] [--state XX] [--verdict V] [--json]

WRITE  (dry run by default — add --commit to actually write)
  apply <plan.json|-> [--commit]
  email --ccn C --subject S [--to T] [--body B | --body-file F] [--sentAt YYYY-MM-DD]
        [--outcome O] [--commit]
  note --ccn C --text T | --text-file F [--commit]
  status --ccn C --status S [--followUpOn YYYY-MM-DD] [--commit]
  upsert --ccn C [--name N] [--city C] [--state XX] [--status S] [--followUpOn D] [--commit]
  correction --ccn C [--verdict V] [--mrfUrl U] [--pointerUrl U] [--domain D]
             [--lastUpdatedOn D] [--templateVersion V] [--checkedOn D] [--note N]
             [--clear] [--commit]
  outcome --ccn C --id ENTRY_ID --outcome O [--commit]
  edit-entry --ccn C --id ENTRY_ID [--subject S] [--to T] [--body B | --body-file F]
             [--sentAt YYYY-MM-DD] [--outcome O] [--text T | --text-file F] [--commit]
  delete-entry --ccn C --id ENTRY_ID [--commit]
  delete --ccn C [--commit]
  restore                                          roll back the last committed write

PLAN FORMAT
  [ { "op": "email",      "ccn": "010148", "subject": "...", "to": "...", "body": "...", "sentAt": "2026-08-28" },
    { "op": "correction", "ccn": "010148", "verdict": "compliant", "mrfUrl": "https://..." },
    { "op": "status",     "ccn": "010148", "status": "resolved", "followUpOn": "" },
    { "op": "note",       "ccn": "010148", "text": "..." },
    { "op": "outcome",    "ccn": "010148", "id": "mtdhw8hu-862o66", "outcome": "replied" },
    { "op": "edit-entry", "ccn": "010148", "id": "mtdhw8hu-862o66", "body": "the corrected text" } ]

  ops: status | upsert | email | note | correction | outcome | edit-entry | delete-entry | delete
  statuses: ${store.STATUSES.join(' | ')}
  outcomes: ${store.OUTCOMES.join(' | ')}
  verdicts: ${store.VERDICTS.filter(Boolean).join(' | ')}

  Dates are YYYY-MM-DD and URLs must be absolute http(s); the store silently
  discards anything else. A run prints "discarded:" for every field it dropped or
  rewrote — read those, they are invisible in the diff itself.

  edit-entry rewrites an entry in place: it keeps the id and the original logged-at
  time, stamps editedAt, and leaves out every field you omit. It cannot change an
  entry's kind, and unlike a fresh email a malformed sentAt keeps the stored date
  rather than falling back to today.
`;

function main() {
  // `… | head` closes stdout early; that is not an error worth a stack trace.
  process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));
  store.load();

  switch (cmd) {
    case 'find': return cmdFind(args);
    case 'show': return cmdShow(args);
    case 'list': return cmdList(args);
    case 'apply': return applyPlan(readPlan(args._[0]), !!args.commit);
    case 'email':
    case 'note':
    case 'status':
    case 'upsert':
    case 'correction':
    case 'outcome':
    case 'edit-entry':
    case 'delete-entry':
    case 'delete':
      return cmdSingle(cmd, args);
    case 'restore': {
      store.restore();
      process.stdout.write(`restored ${path.relative(ROOT, store.DATA_FILE)} from backup\n`);
      return undefined;
    }
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      process.stdout.write(HELP);
      return undefined;
    default:
      return die(`unknown command "${cmd}" — try \`help\``);
  }
}

main();
