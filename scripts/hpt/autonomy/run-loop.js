#!/usr/bin/env node
// Restartable orchestrator: fresh opencode session per batch, rebuild + guard outside the agent.
//
//   node scripts/hpt/autonomy/run-loop.js [--model zai-coding-plan/glm-5.3-flash] [--variant low]
//        [--batch 3] [--max-iterations 200] [--max-stalls 4] [--timeout-min 40]
//
// Safe to Ctrl+C and rerun: all progress lives in data/hpt-audit/autonomy/ledger.jsonl.
// Exit codes: 0 done, 2 stalled/rate-limited out, 3 guard/privacy halt (see tmp/autonomy/HALT.md), 4 finished queue but final check failed.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = path.resolve(__dirname, '../../..');
const tmpDir = path.join(root, 'tmp/autonomy');
const goal = path.join(root, 'scripts/hpt/autonomy/goal.js');
const lockPath = path.join(tmpDir, 'loop.lock');
const statePath = path.join(tmpDir, 'loop-state.json');
const haltPath = path.join(tmpDir, 'HALT.md');
const ledgerPath = path.join(root, 'data/hpt-audit/autonomy/ledger.jsonl');

function opt(name, def) { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; }
const MODEL = opt('model', 'zai-coding-plan/glm-5.3-flash');
const VARIANT = opt('variant', 'low');
const BATCH = Number(opt('batch', 3));
const MAX_IT = Number(opt('max-iterations', 200));
const MAX_STALLS = Number(opt('max-stalls', 4));
const TIMEOUT_MS = Number(opt('timeout-min', 40)) * 60e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

fs.mkdirSync(tmpDir, { recursive: true });
const node = (args, o = {}) => cp.spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, ...o });
const g = (...args) => node([goal, ...args]);
const ledgerCount = () => (fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).length : 0);
const handled = () => { try { return JSON.parse(g('status').stdout).handled; } catch { return -1; } };

function halt(code, title, body) {
  fs.writeFileSync(haltPath, `# HALT: ${title}\n\n${new Date().toISOString()}\n\n\`\`\`\n${body}\n\`\`\`\n\nFix, delete this file, and rerun the loop. Nothing was committed or pushed.\n`);
  log('HALT:', title); console.error(body);
  process.exit(code);
}
// --- single-instance lock
if (fs.existsSync(lockPath)) {
  const pid = Number(fs.readFileSync(lockPath, 'utf8'));
  let alive = false; try { process.kill(pid, 0); alive = true; } catch { /* stale */ }
  if (alive) { console.error(`another loop is running (pid ${pid})`); process.exit(1); }
}
fs.writeFileSync(lockPath, String(process.pid));
const cleanup = () => { try { fs.unlinkSync(lockPath); } catch { /* ignore */ } };
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));
if (fs.existsSync(haltPath)) { console.error(`HALT file present: ${haltPath}\n` + fs.readFileSync(haltPath, 'utf8').slice(0, 800)); process.exit(3); }

function opencodeBin() {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  const p = path.join(process.env.APPDATA || '', 'npm/node_modules/opencode-ai/bin/opencode.exe');
  return fs.existsSync(p) ? p : 'opencode';
}
function killTree(pid) { cp.spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); }

function runAgent(prompt, logFile) {
  return new Promise((resolve) => {
    const args = ['run', '--auto', '--model', MODEL, '--title', 'hpt audit batch'];
    if (VARIANT) args.push('--variant', VARIANT);
    args.push(prompt);
    const out = fs.createWriteStream(logFile);
    const child = cp.spawn(opencodeBin(), args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let timedOut = false, tail = '';
    const onData = (d) => { out.write(d); tail = (tail + d.toString()).slice(-4000); };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, TIMEOUT_MS);
    child.on('close', (code) => { clearTimeout(timer); out.end(); resolve({ code, timedOut, tail }); });
    child.on('error', (e) => { clearTimeout(timer); out.end(); resolve({ code: -1, timedOut, tail: String(e) }); });
  });
}
function rebuild() {
  log('rebuild (reconcile-all)...');
  const r = node(['--max-old-space-size=8192', 'scripts/hpt/rebuild-reviewed-artifacts.js'], { timeout: 45 * 60e3 });
  if (r.status !== 0) return `rebuild failed (exit ${r.status}):\n${(r.stderr || '').slice(-1500)}\n${(r.stdout || '').slice(-1500)}`;
  return null;
}
function privacy() {
  for (const args of [['scripts/protect-public-contacts.js', '--check'], ['scripts/hpt/obfuscate-pointers.js', '--check']]) {
    const r = node(['--max-old-space-size=8192', ...args], { timeout: 20 * 60e3 });
    if (r.status !== 0) return `privacy check failed: ${args.join(' ')}\n${(r.stdout || '').slice(-1200)}${(r.stderr || '').slice(-1200)}`;
  }
  return null;
}
const day = () => new Date().toISOString().slice(0, 10);

(async () => {
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { baseline_day: null, stalls: 0, iteration: 0 };
  const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
  log(`loop start model=${MODEL} variant=${VARIANT || '-'} batch=${BATCH}`);

  for (let it = 1; it <= MAX_IT; it++) {
    state.iteration++;
    const st = g('status');
    log('status', st.stdout.trim());
    if (st.status === 0) {
      const fin = g('final');
      g('report');
      g('checkpoint');
      log(fin.stdout.trim());
      if (fin.status === 0) { log('DONE'); process.exit(0); }
      halt(4, 'queue finished but the final check failed', fin.stderr + fin.stdout);
    }
    // Absorb clock/policy drift once per UTC day, before the agent works, so it is never blamed on an agent.
    if (state.baseline_day !== day()) {
      log('daily baseline: rebuild with no agent changes, then record derived drift');
      const e = rebuild(); if (e) halt(3, 'baseline rebuild failed', e);
      log(g('derive').stdout.trim());
      state.baseline_day = day(); save();
    }
    g('snapshot');
    const a = g('assign', String(BATCH));
    const ccns = JSON.parse(a.stdout).map((r) => r.ccn);
    const ledgerBefore = ledgerCount();
    const prompt = `Follow AGENTS.md. Your assigned CCNs are in tmp/autonomy/batch.json (${ccns.join(', ')}). Process exactly those, log each with goal.js, do not run any rebuild, run goal.js guard, then stop.`;
    const logFile = path.join(tmpDir, `iter-${String(state.iteration).padStart(4, '0')}.log`);
    log(`iteration ${state.iteration}: ${ccns.join(', ')}`);
    const res = await runAgent(prompt, logFile);
    log(`agent exit=${res.code}${res.timedOut ? ' (TIMED OUT, killed)' : ''}`);

    const newEntries = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).slice(ledgerBefore).map((l) => JSON.parse(l));
    if (newEntries.some((e) => e.outcome !== 'no-change')) {
      const e = rebuild(); if (e) halt(3, 'rebuild after agent changes failed', e);
      const p = privacy(); if (p) halt(3, 'privacy check failed after agent changes', p);
    }
    const gd = g('guard', '--since', String(ledgerBefore));
    if (gd.status !== 0) halt(3, 'guard failed (unsupported or collateral change)', gd.stderr + gd.stdout + `\nIteration log: ${logFile}\nTo inspect: git diff, tmp/autonomy/accepted.json is the last accepted state.`);
    g('accept');
    g('checkpoint'); // facts only, from the ledger; written after the guard and privacy checks pass
    g('snapshot'); // the checkpoint legitimately changes accuracy-plan.md; re-baseline so a manual guard run stays green

    const gained = newEntries.length; // ledger lines, not queue shrinkage: promotions remove CCNs from the queue
    const rateLimited = /rate.?limit|429|quota|too many requests|insufficient|overloaded/i.test(res.tail);
    if (gained <= 0 || res.timedOut || rateLimited) {
      state.stalls++;
      const wait = Math.min(60 * 2 ** state.stalls, 1800);
      log(`no progress (stall ${state.stalls}/${MAX_STALLS})${rateLimited ? ' [rate limit?]' : ''}; backing off ${wait}s`);
      save();
      if (state.stalls >= MAX_STALLS) { log('STOP: too many stalled iterations; see', logFile); process.exit(2); }
      await sleep(wait * 1000);
    } else { state.stalls = 0; save(); }
    log(`iteration ${state.iteration} done: +${gained} ledger lines`);
  }
  log('max iterations reached; rerun to continue');
})();
