# Evidence-based recovery run

This run revisits the frozen 856 unresolved records from the September 9 review. It preserves the earlier 34 corrections, three quarantines, 97 publisher-review records, and the original audit CSVs. A correction means the observed pointer, facility identity, and declared file metadata agree; it is not a full validation of every price row or a legal compliance certification.

## Resumable stages

Run these commands from the repository root, one stage at a time:

```text
node scripts/hpt/recovery-run.js inventory
node scripts/hpt/recovery-run.js free
node scripts/hpt/recovery-run.js deepen
node scripts/hpt/recovery-browser.js <observations.json>
node scripts/hpt/recovery-pilot.js
node scripts/hpt/recovery-search-import.js
node scripts/hpt/recovery-run.js refresh
node scripts/hpt/recovery-run.js deepen
node scripts/hpt/recovery-evidence.js
node scripts/hpt/recovery-finalize.js
node scripts/hpt/recovery-finalize.js --apply
npm run hpt:interventions
npm run build
npm test
```

Review every proposed correction before `--apply`. The finalizer checks the saved pointer body, file response hashes, facility/address/state match, current metadata, competing assignments, and original-crawl guard. Application updates the local reviewed-resolution ledger. It does not edit the raw crawl, send outreach, or publish anything.

Private staging lives in `data/hpt-audit/.domain-discovery/recovery-856-v1/`, which is ignored. Public reports live in `data/hpt-audit/rechecks/2026-09-09/recovery-856/`. Do not run two stage processes that write the same discoveries, refs, or budget files. Cached responses are reused; do not delete a paid response or reset the budget to retry a case.

## Retrieval and parsing

GET controls availability. Native transport failures may fall back to curl; local permission failures remain tool errors. Progressive reads use 256 KB, 1 MB, and 4 MB, with larger bounded archive reads. A separate feasibility pass reads complete JSON when late metadata fits the remaining 32 MB budget. Unknown lengths, larger files, unsupported archives, and unresolved metadata remain blockers. Both retained transfer data and decompression have per-file limits; byte counts do not measure transport headers or wire overhead.

Archives are inspected for CSV/JSON members, including members after unrelated files. UTF-8, Windows-1252, and UTF-16 are supported. HTML bodies are distinguished from charge data even when the response MIME type is misleading. Signed query strings are preserved during URL normalization.

## Browser and search observations

Browser jobs are exported to `browser-jobs.json` in staging. Use the connected browser to observe public pages and controls, with at most eight pages, three levels, two facility/download selections, and five minutes per domain. Record actual visited URLs, observed download links, the selected facility, timestamp, and any navigation failure. Browser-only availability is separate from automated access. A link found on a pricing page cannot repair a missing or incorrect pointer by itself.

Import observations as an array of objects with `domain`, optional `ccn`, `checkedAt`, `outcome`, `visited`, `links`, and `note`. Each link needs `url`, `label`, and an actually visited `sourcePageUrl`. Outcomes are `page-read`, `access-denied`, `navigation-failed`, or `tool-unavailable`. An official-domain change additionally requires a roster-compatible `officialIdentity` observation; browser imports never accept a model verdict.

Serper is disabled. GLM search requests are queued for the available web search tool. Store sanitized search observations in `web-search-results.json`, keyed by CCN; each result has `url`, `source`, and `checkedAt`, or a note when no useful result was found. The search importer retrieves the leads and applies the same verification rules. Search snippets alone cannot promote records. The refresh stage shares discovered provider pointers across the frozen cohort and checks the canonical `www` pointer variant where no entries were recovered. It independently retrieves and matches each hospital's candidate files.

## Paid pilot

Only `z-ai/glm-5.3-flash` is used. The run reads the existing OpenRouter key from the ignored `.env.local`, without changing the legacy model configuration. Selection is frozen at up to 60 cases with the specified 20/15/15/10 category allocation. It allows at most three model requests per case, two concurrent requests, a conservative 24,000-token input bound, and 4,096 output tokens.

Endpoint prices are checked first. Reservations use ceilings of $0.15 per million input tokens and $0.50 per million output tokens, plus a margin, even when actual pricing is discounted. Requests set `data_collection: deny`, require supported parameters, and restrict provider pricing. The combined run ceiling stays $10. Actual `usage.cost` is reconciled after each response. Unknown accounting retains the reservation and stops further dispatch. A funded key does not authorize a larger run budget.

GLM JSON-object output is validated locally for permitted actions and supplied evidence IDs. Malformed output consumes a request attempt. Suggested URLs remain unverified leads. The integration does not use JSON-schema enforcement or substitute another model.

## Reading the reports

`assessments.csv` separates website, pointer, identity, file access, metadata, and browser evidence. `file-evidence.csv` contains candidates and rejection reasons. `attempts.json` records reproducible request observations and hashes without raw page content. `followup-queue.csv` lists every remaining record. `verified-corrections.json`, `pilot-spending.json`, and `summary.json` record the applied evidence, costs, and recovery yield.

Earlier page requests retain sanitized excerpts and hashes; raw file reads and the hash-matching pointer responses supporting corrections are retained privately. Browser checks cover selected domains, not every unresolved domain. Remaining browser jobs and unsupported files are explicit follow-up work, not evidence that a hospital failed to publish.
