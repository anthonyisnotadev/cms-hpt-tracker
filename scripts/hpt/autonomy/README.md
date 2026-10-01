# Autonomous audit workflow (OpenCode + GLM 5.3 flash)

```
npm run hpt:autonomy                       # flash/low, 3 CCNs per session, until the queue is done
npm run hpt:autonomy -- --batch 5 --max-iterations 40
npm run hpt:autonomy:status                # queue progress
npm run hpt:autonomy:report                # data/hpt-audit/autonomy/report.md
```
Defaults: `--model zai-coding-plan/glm-5.3-flash --variant low --batch 3 --max-stalls 4 --timeout-min 40`.
Needs `ZAI_API_KEY` in the shell; Chrome is used by the headless Playwright MCP (see `opencode.json`).

## How it stays reliable
- **Fresh session per batch.** All state is in files: `data/hpt-audit/autonomy/ledger.jsonl` (one line per handled CCN), `derived-changes.jsonl`. Ctrl+C and rerun any time.
- **The agent never rebuilds.** After each session the loop rebuilds once, runs the privacy checks, then `goal.js guard`.
- **Guard** halts the loop (exit 3, `tmp/autonomy/HALT.md`) on: state changes for CCNs with no ledger line (collateral), promote/downgrade without a valid proof (URL, SHA-256, name+address, sane timestamps) or in the wrong direction, edited tests/lib/config, a non-5,419 CCN count, or a failed privacy check.
- **Derived drift** (e.g. the >365-day stale rule rolling over, classifier changes) is rebuilt once per UTC day *before* the agent works and written to `derived-changes.jsonl`, so it is never counted as an agent gain or downgrade.
- **Only assigned CCNs can be logged** (`tmp/autonomy/batch.json`). Agents cannot log `relabel`.
- **Stalls/rate limits**: timeouts kill the whole process tree; no new ledger lines or a rate-limit message backs off exponentially, stopping after `--max-stalls` (exit 2).
- **Completion**: queue fully handled **and** `goal.js final` passes (5,419 CCNs; every non-verified one has a next action and observation date). Then `report.md` is written. Human review of promotions and derived downgrades is still required before anything is published.

## Resuming after a halt
Read `tmp/autonomy/HALT.md`, fix or revert the offending change, delete the file, rerun. `tmp/autonomy/iter-NNNN.log` has each session's transcript.
