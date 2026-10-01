# Autonomous audit rules (cms-hpt-tracker)

Goal: all 5,419 CCNs are reconciled; every remaining uncertainty is backed by dated evidence and a specific next step; nothing is promoted or downgraded without supporting evidence.

You are run by an outside loop (`scripts/hpt/autonomy/run-loop.js`) in short sessions. Do **not** try to finish everything. Your job is the 3 CCNs assigned to this session, then stop. State lives in files, not in your memory.

## Your session, step by step
1. Read `tmp/autonomy/batch.json`. It lists your assigned CCNs and their queue records (`next_action`, `evidence_gate`, `reviewed_sources`, ...). Handle **only** those CCNs, in order. The ledger tool rejects any other CCN.
2. For each CCN, grep `data/hpt-audit/accuracy-plan.md` and `data/hpt-audit/reconciliation-*.json` for that CCN. Never read the whole plan file.
3. Decide what the record's `next_action` actually requires, then pick the cheapest check that could change the answer:
   - **Route is documented as blocked / "do not retry until X changes"** → one cheap probe of that condition (single DNS lookup or HEAD/GET). Unchanged → log `no-change` and move on. Share results across CCNs on the same domain in this session.
   - **Route works or evidence is stale/contradictory** → do the full check (below).
4. Full check, independently verifying each of: official website, pointer linkage (`/cms-hpt.txt` entry for this facility), facility name/address/state, file access, declared metadata (CMS version literal, date). Tools: web search, the Z.ai MCP reader, bounded fetches (<= 262,144-byte samples unless a complete file is needed), and the `playwright` headless-browser MCP.
   - If a direct route fails or is blocked, fall back to the hospital's own site in the browser: homepage → search/footer for "price transparency" or "standard charges" → the page's file links. Following ordinary links and expanding menus is fine; record the click path in the proof file. Do not get past login or consent walls, never submit forms, never download more than the bounded sample.
   - Reuse caches in `data/hpt-audit/`. Repeat a check only for a stated reason.
5. If you retrieved new evidence, write a proof file `data/hpt-audit/reconciliation-<slug>-proof-<YYYY-MM-DD>.json` (copy the shape of an existing `reconciliation-*-proof-*.json`): the URLs, HTTP status, byte count, SHA-256, `observed_at` (real time, see below), what was established, what was **not** established. Keep tool observations separate from your inferences.
6. If (and only if) the evidence supports a status change, apply it through the existing mechanism (see `scripts/hpt/apply-*.js` for the pattern). A new apply script must be idempotent and touch only your assigned CCNs. Never hand-edit generated files (`tracker.html`, `*-worklist.json`, `nationwide-*.json`, `*.csv` exports).
7. Log **one ledger line per assigned CCN**: `node scripts/hpt/autonomy/goal.js log '<json>'` (in PowerShell write the JSON to a file and use `log-file <path>`):
   `{"ccn":"010019","outcome":"evidence-gain|recheck|blocked|no-change","disposition_change":"none|promote|downgrade","proof":"data/hpt-audit/reconciliation-....json","reason":"<one sentence>","next_step":"<specific action, required for blocked>"}`
   - `evidence-gain`: you retrieved new page/pointer/file/header/validator evidence. Requires a proof file.
   - `recheck`: you repeated an earlier check with a stated reason and learned nothing new.
   - `blocked`: cannot progress; requires a specific `next_step`.
   - `no-change`: the single cheap probe showed the condition is unchanged.
   - `promote`/`downgrade` require `outcome: evidence-gain` and a proof file with the URLs, SHA-256, and facility name+address evidence. If you are not sure, do **not** promote: log `blocked` or `recheck` with a precise `next_step`. A missed promotion is cheap to fix later; a wrong one is not.
8. Run `node scripts/hpt/autonomy/goal.js guard`, then stop with a 3-line summary. **Do not run any rebuild** (`hpt:verify:reconcile-all`, `rebuild-reviewed-artifacts.js`, `build-*.js`, `npm run build`): the loop does that once per batch and records drift separately.

## Rules the loop enforces (violations halt the whole run)
- State changes only for your assigned CCNs, only with a matching ledger line and valid proof. Collateral changes halt the loop.
- You may add new files. You may **not** edit existing tests, anything under `scripts/hpt/lib/`, `scripts/build-tracker.js`, `scripts/protect-public-contacts.js`, `package.json`, `opencode.json`, this file, `scripts/hpt/autonomy/`, or `data/hpt-audit/accuracy-plan.md` (the loop writes its checkpoint there from the ledger; add no prose to it). Never weaken a test to make it pass.
- Never `git commit/push/reset/checkout/stash`, send email/outreach, publish, use paid services, or sign up for anything (denied in `opencode.json`; don't look for workarounds).
- Never put contact details or patient-level data in public artifacts.

## Judgement rules
- **Real timestamps only.** Get the time with `node -e "console.log(new Date().toISOString())"` and use it for every `observed_at`. Never invent times.
- A client-side failure (DNS error, 403 to automation, `ERR_BLOCKED_BY_CLIENT`, web-reader transport error) is **not** evidence that a file is gone or a hospital is noncompliant.
- A HEAD request with the same size and Last-Modified suggests the file is unchanged but does not prove identical content. Say so; never use it to justify a promotion.
- A newer incomplete check must not erase stronger earlier evidence unless you can cite a supported reason (facility closed, pointer now names another hospital, ...).
- Keep three things distinct: current verification, historical evidence, uncertainty.
- Known open policy question (do not touch): v3 classification of non-canonical version spellings like `3.00` / `3` (`mrf-template-version-noncanonical` vs `compliant-observed`). The loop records any rebuild drift from this as *derived*; you never log it.
