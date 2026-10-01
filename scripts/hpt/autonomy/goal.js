#!/usr/bin/env node
// State + safety rails for the autonomous audit workflow (see AGENTS.md, run-loop.js).
//
//   status                 queue progress; exit 0 only when every queued CCN has a ledger line
//   assign [n]             pick the next n unhandled queue items -> tmp/autonomy/batch.json (only these may be logged)
//   next [n]               print the next n items without assigning
//   log '<json>'           append a validated ledger line   (log-file <path> reads the JSON from a file)
//   snapshot               record hashes of protected files (tests, lib) for the guard
//   guard [--since N]      fail on collateral/unsupported state changes, bad proofs, edited protected files
//   derive                 log state changes NOT made by the agent (clock/policy drift) to derived-changes.jsonl
//   accept                 make the current state the accepted baseline
//   final                  completion check across all CCNs; exit 0 only if the goal conditions hold
//   report                 write data/hpt-audit/autonomy/report.md (gains vs rechecks vs relabels, review list)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const root = path.resolve(__dirname, '../../..');
const audit = path.join(root, 'data/hpt-audit');
const outDir = path.join(audit, 'autonomy');
const ledgerPath = path.join(outDir, 'ledger.jsonl');
const derivedPath = path.join(outDir, 'derived-changes.jsonl');
const tmpDir = path.join(root, 'tmp/autonomy');
const acceptedPath = path.join(tmpDir, 'accepted.json');
const protectedPath = path.join(tmpDir, 'protected.json');
const batchPath = path.join(tmpDir, 'batch.json');
const EXPECTED_CCNS = 5419;
const OUTCOMES = ['evidence-gain', 'recheck', 'relabel', 'blocked', 'no-change'];
const CHANGES = ['none', 'promote', 'downgrade'];
// Higher = stronger standing. Only used to check promote/downgrade direction.
const RANK = {
  'verified-current-mrf': 5,
  'verified-template-review': 4, 'verified-stale-mrf': 4,
  'file-custom-workbook-review': 3, 'linked-mrf-header-unmatched': 3, 'pointer-linked-file-review-pending': 3,
  'mrf-facility-identity-unresolved': 2, 'pointer-facility-match-unresolved': 2, 'pointer-linked-file-not-probed': 2,
  'mrf-verification-pending': 2, 'selected-file-only-in-earlier-pointer-version': 2,
  'pointer-not-retrieved': 1, 'pointer-access-denied-to-client': 1, 'pointer-discovery-incomplete': 1,
  'mrf-request-unsuccessful': 1, 'official-website-not-identified-completed-search': 1,
};
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const readLines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const append = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, JSON.stringify(o) + '\n'); };
const fail = (code, msg) => { console.error(msg); process.exit(code); };

const ledger = () => readLines(ledgerPath);
const queue = () => readJson(path.join(audit, 'unresolved-investigation-worklist.json')).records
  .slice().sort((a, b) => a.investigation_tier - b.investigation_tier || a.ccn.localeCompare(b.ccn));
const nationwide = () => readJson(path.join(audit, 'nationwide-verification.json')).records;
const stateKey = (r) => `${r.disposition}|${r.standing_finding}|${r.mrf_state}`;
function stateMap(records) { const o = {}; for (const r of records) o[r.ccn] = stateKey(r); return o; }
function remaining() { const done = new Set(ledger().map((e) => e.ccn)); return queue().filter((r) => !done.has(r.ccn)); }
const rank = (key) => RANK[(key || '').split('|')[0]];

function walk(v, fn, k) {
  if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(vv, fn, kk);
  else fn(k, v);
}
// Structural checks on a proof file; the substance still needs a human spot-check (see report.md).
function proofProblems(e) {
  if (!e.proof) return [];
  let txt, doc;
  try { txt = fs.readFileSync(path.join(root, e.proof), 'utf8'); doc = JSON.parse(txt); } catch { return ['proof is not readable JSON: ' + e.proof]; }
  const probs = [];
  if (!/https?:\/\//.test(txt)) probs.push('proof names no URL');
  if (e.disposition_change === 'promote' || e.disposition_change === 'downgrade') {
    if (!/\b[a-f0-9]{64}\b/i.test(txt)) probs.push('promote/downgrade proof has no SHA-256');
    if (!/address/i.test(txt) || !/name/i.test(txt)) probs.push('promote/downgrade proof lacks facility name/address evidence');
  }
  const ref = e.at ? Date.parse(e.at) : Date.now();
  walk(doc, (k, v) => {
    if (typeof v === 'string' && /(observed|retrieved|checked)_at$/i.test(k || '')) {
      const t = Date.parse(v);
      if (Number.isNaN(t)) probs.push(`unparseable ${k}: ${v}`);
      else if (t > ref + 10 * 60e3) probs.push(`${k} is in the future: ${v}`);
      else if (t < ref - 48 * 3600e3) probs.push(`${k} is >48h before the ledger entry: ${v}`);
    }
  });
  return probs;
}
function validateEntry(e, batch) {
  const errs = [];
  if (!/^\d{6}$/.test(e.ccn || '')) errs.push('ccn must be 6 digits');
  if (batch && !batch.includes(e.ccn)) errs.push(`ccn ${e.ccn} was not assigned this session (assigned: ${batch.join(',')})`);
  if (ledger().some((x) => x.ccn === e.ccn)) errs.push(`ccn ${e.ccn} already has a ledger line`);
  if (!OUTCOMES.includes(e.outcome)) errs.push('outcome must be ' + OUTCOMES.join('|'));
  if (!CHANGES.includes(e.disposition_change || 'none')) errs.push('disposition_change must be ' + CHANGES.join('|'));
  if (!e.reason) errs.push('reason required');
  if (e.outcome === 'blocked' && !e.next_step) errs.push('blocked requires next_step');
  if (e.outcome === 'relabel') errs.push('agents may not log relabel: derived rebuild changes are recorded by the loop, not by you');
  if (e.proof && !fs.existsSync(path.join(root, e.proof))) errs.push('proof file not found: ' + e.proof);
  const needsProof = e.outcome === 'evidence-gain' || (e.disposition_change && e.disposition_change !== 'none');
  if (needsProof && !e.proof) errs.push('proof required for evidence-gain and any promote/downgrade');
  if (e.disposition_change && e.disposition_change !== 'none' && e.outcome !== 'evidence-gain') errs.push('promote/downgrade requires outcome=evidence-gain');
  if (!errs.length) errs.push(...proofProblems({ ...e, at: new Date().toISOString() }));
  return errs;
}
const PROTECTED_GLOBS = [
  ['scripts/hpt/test', /\.test\.js$/], ['scripts/hpt/lib', /\.js$/], ['scripts', /^(build-tracker|protect-public-contacts)\.js$/],
  ['scripts/hpt/autonomy', /\.(js|ps1)$/], ['.', /^(AGENTS\.md|opencode\.json|package\.json)$/], ['data/hpt-audit', /^accuracy-plan\.md$/],
];
function protectedHashes() {
  const out = {};
  for (const [dir, re] of PROTECTED_GLOBS) {
    const d = path.join(root, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) if (re.test(f) && fs.statSync(path.join(d, f)).isFile()) out[path.posix.join(dir, f)] = sha(path.join(d, f));
  }
  return out;
}

const argv = process.argv.slice(2);
const [cmd, arg] = argv;
const sinceIdx = argv.indexOf('--since') >= 0 ? Number(argv[argv.indexOf('--since') + 1]) : 0;

if (cmd === 'status') {
  const q = queue(), rem = remaining(), l = ledger();
  const by = {};
  for (const e of l) by[e.outcome] = (by[e.outcome] || 0) + 1;
  console.log(JSON.stringify({ queue: q.length, handled: q.length - rem.length, remaining: rem.length, ledger_total: l.length, ledger_by_outcome: by }));
  process.exit(rem.length ? 1 : 0);
} else if (cmd === 'assign' || cmd === 'next') {
  const items = remaining().slice(0, Number(arg) || 3);
  if (cmd === 'assign') {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(batchPath, JSON.stringify({ assigned_at: new Date().toISOString(), ccns: items.map((r) => r.ccn), records: items }, null, 2));
  }
  console.log(JSON.stringify(items, null, 2));
} else if (cmd === 'log' || cmd === 'log-file') {
  const e = cmd === 'log' ? JSON.parse(arg) : readJson(path.resolve(arg));
  const batch = fs.existsSync(batchPath) ? readJson(batchPath).ccns : null;
  const errs = validateEntry(e, batch);
  if (errs.length) fail(2, 'LEDGER REJECTED: ' + errs.join('; '));
  append(ledgerPath, { at: new Date().toISOString(), disposition_change: 'none', ...e });
  console.log('logged ' + e.ccn);
} else if (cmd === 'snapshot') {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(protectedPath, JSON.stringify(protectedHashes()));
  console.log('protected-file hashes saved');
} else if (cmd === 'accept') {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(acceptedPath, JSON.stringify(stateMap(nationwide())));
  console.log('accepted baseline updated');
} else if (cmd === 'derive') {
  // State changes that no ledger line with a promote/downgrade explains: record as derived, never as agent work.
  let base;
  if (fs.existsSync(acceptedPath)) base = readJson(acceptedPath);
  else base = stateMap(JSON.parse(cp.execFileSync('git', ['show', 'HEAD:data/hpt-audit/nationwide-verification.json'], { cwd: root, maxBuffer: 1 << 30 }).toString()).records);
  const claimed = new Set(ledger().filter((e) => e.disposition_change && e.disposition_change !== 'none').map((e) => e.ccn));
  const already = new Set(readLines(derivedPath).map((d) => `${d.ccn}|${d.to}`));
  let n = 0;
  for (const r of nationwide()) {
    const to = stateKey(r);
    if (base[r.ccn] === undefined || base[r.ccn] === to || claimed.has(r.ccn) || already.has(`${r.ccn}|${to}`)) continue;
    append(derivedPath, {
      at: new Date().toISOString(), ccn: r.ccn, from: base[r.ccn], to, cause: 'derived-rebuild',
      direction: rank(to) > rank(base[r.ccn]) ? 'up' : rank(to) < rank(base[r.ccn]) ? 'down' : 'lateral',
      note: 'Changed by a rebuild with no agent evidence (clock rollover such as the >365-day stale rule, or classifier/policy change). Needs human review; not an evidence gain.',
    });
    n++;
  }
  console.log(`derived changes recorded: ${n}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(acceptedPath, JSON.stringify(stateMap(nationwide())));
} else if (cmd === 'guard') {
  const problems = [], warnings = [];
  const records = nationwide();
  if (new Set(records.map((r) => r.ccn)).size !== EXPECTED_CCNS || records.length !== EXPECTED_CCNS) problems.push(`expected ${EXPECTED_CCNS} unique CCNs, found ${records.length}`);
  for (const r of records) {
    if (!r.next_action && r.disposition !== 'verified-current-mrf' && !/^scope-exempt/.test(r.disposition)) problems.push(`${r.ccn}: empty next_action on unresolved/non-verified record`);
  }
  if (fs.existsSync(protectedPath)) {
    const before = readJson(protectedPath), now = protectedHashes();
    for (const f of Object.keys(before)) if (now[f] !== before[f]) problems.push(`protected file changed or removed: ${f} (agents may add new files but not edit tests/lib/config)`);
  }
  if (fs.existsSync(acceptedPath)) {
    const pre = readJson(acceptedPath), now = stateMap(records);
    const entries = ledger().slice(sinceIdx);
    const last = new Map(entries.map((e) => [e.ccn, e]));
    for (const ccn of Object.keys(now)) {
      if (pre[ccn] === undefined || pre[ccn] === now[ccn]) continue;
      const e = last.get(ccn);
      if (!e) { problems.push(`${ccn}: COLLATERAL state change (${pre[ccn]} -> ${now[ccn]}) with no ledger line this iteration`); continue; }
      if (e.disposition_change === 'none') { problems.push(`${ccn}: state changed but ledger says disposition_change=none`); continue; }
      const a = rank(pre[ccn]), b = rank(now[ccn]);
      if (e.disposition_change === 'promote' && !(b > a)) problems.push(`${ccn}: ledger says promote but ${pre[ccn].split('|')[0]} -> ${now[ccn].split('|')[0]} is not a promotion`);
      if (e.disposition_change === 'downgrade' && !(b < a)) problems.push(`${ccn}: ledger says downgrade but ${pre[ccn].split('|')[0]} -> ${now[ccn].split('|')[0]} is not a downgrade`);
    }
    for (const e of entries) {
      for (const p of proofProblems(e)) problems.push(`${e.ccn}: ${p}`);
      if (argv.includes('--since') && e.disposition_change !== 'none' && pre[e.ccn] === now[e.ccn]) warnings.push(`${e.ccn}: ledger says ${e.disposition_change} but tracked state is unchanged (rebuild missing?)`);
    }
  } else warnings.push('no accepted baseline yet; state-change checks skipped');
  for (const w of warnings) console.error('warn: ' + w);
  if (problems.length) fail(3, 'GUARD FAILED\n' + problems.join('\n'));
  console.log('guard ok');
} else if (cmd === 'final') {
  const problems = [];
  const rem = remaining();
  if (rem.length) problems.push(`${rem.length} queued CCNs have no ledger line`);
  const records = nationwide();
  if (records.length !== EXPECTED_CCNS) problems.push(`expected ${EXPECTED_CCNS} records, found ${records.length}`);
  const open = records.filter((r) => r.disposition !== 'verified-current-mrf' && !/^scope-exempt/.test(r.disposition));
  const noNext = open.filter((r) => !r.next_action);
  const noDate = open.filter((r) => !(r.observed_at || r.standing_checked_at || r.report_generated_at));
  if (noNext.length) problems.push(`${noNext.length} non-verified CCNs have no next_action`);
  if (noDate.length) problems.push(`${noDate.length} non-verified CCNs have no observation date`);
  const derived = readLines(derivedPath).filter((d) => d.direction === 'down');
  const summary = { ccns: records.length, verified_current: records.length - open.length - records.filter((r) => /^scope-exempt/.test(r.disposition)).length, non_verified_with_next_step: open.length - noNext.length, derived_downgrades_awaiting_human_review: derived.length };
  console.log(JSON.stringify(summary));
  if (problems.length) fail(1, 'NOT DONE\n' + problems.join('\n'));
  console.log('FINAL OK (human review of report.md still required before publishing anything)');
} else if (cmd === 'checkpoint') {
  // Facts-only block, regenerated in place from the ledger/data. The model never writes prose into accuracy-plan.md.
  const planPath = path.join(audit, 'accuracy-plan.md');
  const l = ledger(), d = readLines(derivedPath), recs = nationwide();
  const q = readJson(path.join(audit, 'unresolved-investigation-worklist.json'));
  const by = (o) => l.filter((e) => e.outcome === o);
  const changes = l.filter((e) => e.disposition_change !== 'none');
  const down = d.filter((x) => x.direction === 'down');
  const verified = recs.filter((r) => r.disposition === 'verified-current-mrf').length;
  const BEGIN = '<!-- autonomy-checkpoint:begin -->', END = '<!-- autonomy-checkpoint:end -->';
  const ids = (arr) => arr.map((e) => e.ccn).join(', ') || 'none';
  const changeText = changes.length ? changes.map((e) => `${e.ccn} ${e.disposition_change} (\`${e.proof}\`)`).join('; ') : 'none';
  const block = [
    BEGIN,
    `## Autonomous loop checkpoint (auto-generated ${new Date().toISOString()}; do not hand-edit this block)`,
    '',
    `- **Scope/progress:** ${recs.length} CCNs in nationwide-verification; investigation queue ${q.summary.total} items (tiers ${JSON.stringify(q.summary.by_tier)}); model-run batches have handled ${l.length} CCNs (\`data/hpt-audit/autonomy/ledger.jsonl\`). Raw verified-current-mrf: ${verified}.`,
    `- **Evidence gains (new retrieved evidence): ${by('evidence-gain').length}** — ${ids(by('evidence-gain'))}. **Rechecks (no new evidence): ${by('recheck').length}. No-change single probes: ${by('no-change').length}. Blocked with a next step: ${by('blocked').length}.** These categories are not interchangeable.`,
    `- **Agent status changes, each backed by a proof file (human review pending):** ${changeText}.`,
    `- **Derived changes, not evidence (clock/classifier drift recorded by the loop):** ${d.length}, of which ${down.length} are downgrades awaiting a human policy decision (${down.map((x) => x.ccn).join(', ') || 'none'}). See \`derived-changes.jsonl\`.`,
    '- **Guardrails in force:** one loop-run rebuild per batch; contact and pointer privacy checks and the state-change guard passed before this block was written; no commit, push, outreach or publication.',
    END,
    '',
  ].join('\n');
  let plan = fs.readFileSync(planPath, 'utf8');
  const a = plan.indexOf(BEGIN), b = plan.indexOf(END);
  if (a >= 0 && b > a) plan = plan.slice(0, a) + block + plan.slice(b + END.length).replace(/^\r?\n/, '');
  else { const h = plan.indexOf('\n## '); plan = plan.slice(0, h + 1) + block + '\n' + plan.slice(h + 1); }
  fs.writeFileSync(planPath, plan);
  console.log('accuracy-plan.md checkpoint updated');
} else if (cmd === 'report') {
  const l = ledger(), d = readLines(derivedPath);
  const by = (o) => l.filter((e) => e.outcome === o);
  const lines = ['# Autonomous audit report', '', `Generated ${new Date().toISOString()}`, '',
    `Ledger: ${l.length} CCNs handled. **Evidence gains: ${by('evidence-gain').length}**; rechecks: ${by('recheck').length}; no-change: ${by('no-change').length}; blocked: ${by('blocked').length}. Derived (non-agent) changes: ${d.length}.`, '',
    '## Status changes made by the agent (human review these proofs)', ''];
  for (const e of l.filter((x) => x.disposition_change !== 'none')) lines.push(`- ${e.ccn} **${e.disposition_change}** — ${e.reason} — \`${e.proof}\``);
  lines.push('', '## Derived changes (clock/policy drift, NOT evidence)', '');
  for (const x of d) lines.push(`- ${x.ccn} (${x.direction}) ${x.from.split('|')[0]} -> ${x.to.split('|')[0]}`);
  lines.push('', '## Blocked / next steps', '');
  for (const e of by('blocked')) lines.push(`- ${e.ccn}: ${e.next_step}`);
  fs.writeFileSync(path.join(outDir, 'report.md'), lines.join('\n') + '\n');
  console.log('wrote data/hpt-audit/autonomy/report.md');
} else {
  fail(64, 'usage: goal.js status|assign [n]|next [n]|log <json>|log-file <path>|snapshot|guard [--since N]|derive|accept|final|checkpoint|report');
}
