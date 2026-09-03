# CMS-HPT harvester

Finds and downloads the `cms-hpt.txt` pointer file - and the machine-readable
files (MRFs) it points to - for every hospital in `cms_data/Hospital_General_Information.csv`
(5,419 hospitals).

```bash
node scripts/hpt/run.js seed
```

## Why it is shaped this way

Three facts drive the whole design, and each was measured on live sites rather
than assumed:

1. **Blocking is not the main obstacle.** On a 60-domain sample, a plain
   unauthenticated `fetch` retrieved the pointer file **63%** of the time, and
   only **5%** returned a hard 403. On the first 150 real domains the free tier
   succeeded **87%** of the time with 7 blocks. Paying to proxy every request
   would be spending money on a problem that mostly is not there.

2. **The hard part is knowing which domain to ask.** The CMS dataset has no
   website column. The dominant failure is a 404 from the *wrong* domain, not a
   block. So the pipeline spends its effort on domain discovery and treats
   unblocking as a narrow exception.

3. **One file often covers a whole system.** `cms-hpt.txt` lists every location
   an operator owns - `encompasshealth.com` returns 185 of them, `providence.org`
   61. Fetching 150 domains produced pointer data for **1,215 hospitals**. Work
   is therefore scheduled per *domain*, highest hospital-count first.

## Pipeline

Each stage is resumable - re-running skips anything already recorded - and all
state lands in `cms_data/hpt/` (already gitignored).

| Stage | What it does | Cost |
|---|---|---|
| `seed` | Builds the roster and seeds domains from an open MRF-link dataset keyed by CCN (96% CCN overlap) | free |
| `candidates` | Builds the candidate-domain pool from Wikidata, orphan entries, guesses, and search | free except `--source=search` |
| `verify` | Tests each candidate domain with one request and keeps the ones that prove out | free |
| `pointers` | Fetches `/cms-hpt.txt` per known domain | free, then paid only on a block |
| `match` | Maps pointer entries to CCNs → `manifest.csv` | free |
| `corroborate` | Reads MRF headers for cross-state candidates `match` deferred on | free |
| `adjudicate` | LLM ruling on near-miss names that scoring cannot settle | cents |
| `recover` | Footer-scans domains that had no pointer file | free |
| `recover --llm` | Model-guided two-hop crawl for the same domains, each hit corroborated against the MRF header before it is kept → `recovered.csv` | cents |
| `npm run hpt:pointers:corpus` | Archive every reachable current `cms-hpt.txt` and emit one normalized CSV | free |
| `dates` | Probes each MRF's last-updated date, size and format **without downloading it** | free |
| `download` | Streams the MRFs listed in the manifest to disk | free, then paid only on a block |
| `gaps` / `report` | Remediation worklist and coverage summary | free |

`resolve` (Exa) is retained only for backward compatibility; `candidates
--source=search` supersedes it.

```bash
# free: everything discoverable without spending anything
node scripts/hpt/run.js seed
node scripts/hpt/run.js pointers                      # ~1,400 seeded domains
node scripts/hpt/run.js match
node scripts/hpt/run.js candidates --source=wikidata
node scripts/hpt/run.js candidates --source=orphan
node scripts/hpt/run.js verify
node scripts/hpt/run.js corroborate                   # settle cross-state candidates
node scripts/hpt/run.js match

# then the cheap paths, for whatever is still missing
node scripts/hpt/run.js candidates --source=search    # Serper free tier
node scripts/hpt/run.js verify
node scripts/hpt/run.js adjudicate                    # cents
node scripts/hpt/run.js match

node scripts/hpt/run.js dates                         # last-updated, no downloads
node scripts/hpt/run.js gaps && node scripts/hpt/run.js report
```

## Combined cms-hpt.txt corpus

Build a local, resumable corpus from the current tracker manifest and domain map:

```bash
npm run hpt:pointers:corpus
```

Known pointer URLs are fetched first. Domains still lacking a valid pointer are
then checked at the CMS-permitted root and `.well-known` paths, across apex and
`www`, including homepage redirects. This command is always direct/free: it
never uses a search API, an unblocker, or downloads any MRF URL listed inside a
pointer file.

Raw files, crawl history, and `cms_hpt_entries.csv` are written under
`cms_data/hpt/pointer-corpus/` and are gitignored. The CSV has one row per MRF
URL, with a diagnostic row for pointer entries that omit `mrf-url`. Exact MRF
URL links to CCNs are kept separate from pointer-level related CCNs so a system
pointer is not misrepresented as a facility match.

The retained raw snapshot under `data/hpt-audit/pointers/` also carries public
contact names and emails. Run `npm run obfuscate:pointers` to protect only those
values at rest and `npm run check:pointers-private` to verify none remain in
plaintext. The key is intentionally tracked for local decoding by every clone;
this is search-engine obfuscation rather than secret encryption. Once it exists,
future `pointers` and `verify` writes are protected automatically. Copy newly
written working files into the retained snapshot before publishing. `npm run
serve` and `npm run serve:outreach` decrypt raw pointer responses in memory for
local use.

To build a reviewable corpus from an external domain-candidate CSV without
importing anything into the tracker, run the two stages separately:

```bash
node scripts/hpt/pointer-corpus.js --external-only --root-only --domain-csv=cms_data/hpt/external_link_candidates.csv --dataset=external-links --out=cms_data/hpt/external-pointer-corpus --csv=cms_data/hpt/external_cms_hpt_entries.csv
node scripts/hpt/probe-pointer-corpus.js --input=cms_data/hpt/external_cms_hpt_entries.csv --out=cms_data/hpt/external_cms_hpt_mrf_headers.csv --cache=cms_data/hpt/external-pointer-corpus/mrf-header-cache.json --concurrency=40 --per-host=4
```

The first CSV preserves every entry and every MRF URL declared by each fetched
pointer file, together with raw-file hashes and source-domain provenance. The
`--root-only` option requests only `https://<candidate-domain>/cms-hpt.txt`
(ordinary HTTP redirects are still followed), which is the appropriate boundary
when an external list is being used only as a domain lead. The
second has one row per unique MRF and records only a HEAD request plus a capped
Range GET. Its `header_matched_ccns` and `review_ccns` are evidence for later
review, not import instructions; it does not mutate the manifest or domain map.

The default reuses valid cached successes and skips recorded failures. Use
`--retry-failed` to retry failures or `--refresh` for a fresh crawl. Operational
controls are `--limit=N`, `--concurrency=N`, and `--timeout=MS`.

After reviewing the header output, import only its conservative `matched` rows
into the tracker snapshot with the two-phase importer:

```bash
node scripts/hpt/import-corpus.js --evidence-dir=cms_data/hpt/new
node scripts/hpt/run.js dates --noUnblocker
node scripts/hpt/import-corpus.js --evidence-dir=cms_data/hpt/new --publish
```

The evidence directory may contain `external_cms_hpt_mrf_headers.csv`,
`direct_mrf_headers.csv`, or both. Duplicate observations of the same
CCN/MRF pair are collapsed. A CCN tied to multiple distinct MRF URLs is left out
and listed under `conflictingCcns` in `cms_data/hpt/corpus_import.json`; review,
unmatched, and unreachable header rows are never imported. Existing manifest
CCNs are not replaced. The cached header metadata is reused by `dates`, so this
workflow does not repeat network probes for the new rows.

### Direct MRF link inventory

Third-party CCN and URL inventories are leads rather than import authority.
Prepare only current-roster hospitals that are still absent from the manifest,
then probe every distinct MRF with a HEAD request and capped Range GET:

```bash
npm run hpt:direct-mrf:prepare -- --input=path/to/links.csv
npm run hpt:direct-mrf:headers
# or run both stages
npm run hpt:direct-mrf
```

Preparation writes `direct_mrf_entries.csv`, `direct_mrf_review.csv`, and
`direct_mrf_stage.json` under `cms_data/hpt/new`. The original CSV is never
modified. The header stage writes `direct_mrf_headers.csv` and uses a resumable
cache under `cms_data/hpt/direct-mrf/`. It never downloads a complete MRF.
Import accepts a row only when the reachable MRF header independently matches
the same claimed CCN, including state and facility-location evidence. Existing
manifest CCNs, state conflicts, unclaimed header matches, ambiguous facilities,
unreachable links, and CCNs with multiple surviving MRF URLs remain unimported.
Use the standard two-phase `import-corpus.js` commands above after reviewing the
header output.

`match`, `corroborate` and `adjudicate` form a loop: each pass surfaces work for
the next, so re-running `match` after either stage is expected and cheap.

`--retryFailed` on `dates` re-probes anything without a declared date - including
records probed before compressed files could be read - rather than trusting a
stored success flag.

Useful flags: `--limit=N` (trial run), `--concurrency=N`, `--retryFailed`,
`--noUnblocker` (never spend money), `--maxMb=N` (skip MRFs larger than N MB,
default 512).

## Candidates and verification

Domain discovery does not need an accurate source, because **`cms-hpt.txt`
verifies itself**: the file lists its own location names, so a candidate can be
confirmed or discarded for the price of one HTTP request. Candidate *precision*
is therefore irrelevant - only recall and cost matter.

```
candidates.json   { ccn: [ {domain, source, score}, ... ] }
     ↑ wikidata | orphan | heuristic | serper
     ↓
verify   →  one GET per unique domain (reusing pointers.json)
            keep it when an entry names the proposing hospital
```

Sources are stacked cheapest-first, and `--source=search` only queries hospitals
that have no free candidate left. Measured hit rates on hospitals still missing
a domain:

| Source | Yield | Cost |
|---|---|---|
| Wikidata (one SPARQL query) | 838 candidates for 642 hospitals | free |
| Orphan entries | 910 candidates for 446 hospitals | free |
| Serper search | ~26% of hospitals resolved | free tier (2,500) |
| Heuristic name guesses | **9%** - below the 15% bar, not run by default | free but ~12 requests/hospital |

The heuristic generator stays available behind `--source=heuristic` as a last
resort: it costs nothing but bandwidth, and every hit it produced scored 1.00.

## How a name is matched to a CCN

Names alone are not enough - `ST. MARY'S HOSPITAL` scores 1.00 against a
hospital in another state - so matching climbs a ladder of evidence and stops at
the first level that settles it:

1. **Per domain.** Entries are matched greedily and one-to-one against the
   hospitals assigned to that domain.
2. **Cross-domain, in footprint.** Leftover entries are ranked against the whole
   roster; a winner inside the domain's known states is accepted on score.
3. **Cross-domain, out of footprint → corroborate.** Systems buy hospitals
   across state lines, so these are checked rather than excluded. The MRF header
   carries the hospital's own address and its `license_number|<ST>` licensing
   state, read for free during the ranged probe. Agreement accepts; disagreement
   rejects; an unread header defers to `corroborate`.
4. **Near-miss → adjudicate.** A rename such as `Baptist Health Shelby Hospital`
   vs `SHELBY BAPTIST MEDICAL CENTER` scores 0.77, under the 0.82 bar, and no
   string metric will fix that. Those pairs go to an LLM with the address and
   licensing state in the prompt. Only an affirmative **high-confidence** verdict
   is accepted, and every verdict is cached.

If the winner fails corroboration, matching falls back to the best in-footprint
candidate rather than abandoning the entry - otherwise a cross-state collision
would knock out the correct in-state hospital.

## Where the pointer file can live

CMS permits the site root **or** `.well-known`, and both apex and `www`. All four
are tried, plus a homepage-redirect retry that catches systems which have merged
since the seed data was collected - `mercyhealth.com` now redirects to
`trinityhealthmichigan.org`, `memorial.org` to `commonspirit.org`.

## Unblocker

Only reached after a domain actually refuses the free request. Oxylabs and Decodo
both expose a realtime scrape endpoint with the same request/response shape, so
one adapter covers either:

```bash
HPT_SEARCH=serper           # or: decodo | exa
SERPER_API_KEY=...
OPENROUTER_API_KEY=...      # adjudication; OPENROUTER_MODEL optional

HPT_UNBLOCKER=decodo        # or: oxylabs
DECODO_USERNAME=...         # or: OXYLABS_USERNAME
DECODO_PASSWORD=...         # or: OXYLABS_PASSWORD
```

With no credentials set the run still completes; blocked domains are recorded so
a later pass can pick them up once a provider is configured.

## The gap worklist

`gaps` lists every hospital not yet in the manifest, tagged with what would
actually fix it. The buckets exist because the fixes are **not**
interchangeable, and treating them as one list wastes money:

| Bucket | Fix | Why not just search for it |
|---|---|---|
| `exa-domain-lookup` | `candidates --source=search` (`exa_query` pre-filled) | genuinely no domain, or the seeded one is wrong |
| `run-pointers-first` | nothing - run the free pass | not a gap yet, just unrun work |
| `name-match-review` | `adjudicate`, or manual | the pointer file already works; discovery is not the problem |
| `unblocker` | Decodo / Oxylabs | the domain is right and refusing us; a search returns the same host |
| `exempt-federal` | skip | VA/DoD are outside 45 CFR 180 |

Two things this prevents. Blocked hospitals are counted per *domain*, not per
hospital - 124 blocked hospitals were only 66 domains, so pricing them per
hospital overstates the work. And hospitals whose system publishes a working
pointer file are never sent to a search API, because the answer is already in
hand.

```bash
node scripts/hpt/run.js gaps                    # writes gaps.csv + gaps_<bucket>.csv
node scripts/hpt/run.js gaps --import=fixed.csv # read hand-corrected domains back
```

Each row has a blank `resolved_domain` column: fill it in by hand, import, then
re-run `pointers && match`. Nothing needs editing JSON directly.

## Finding hospitals with no domain - `find-domains.js`

`gaps.csv`'s largest bucket is hospitals with no working domain at all - nothing
to crawl and nobody to email. `node scripts/hpt/find-domains.js` attacks that
list directly, cheapest source first, and gates every hit on evidence:

| phase | what | cost |
|---|---|---|
| 1 | heuristic name-slug domains + any `seeded_domain`, one GET to `/cms-hpt.txt` each | free |
| 2 | optional real web search (`--search`), with every result verified the same way | provider-dependent |
| 3 | model-proposed domains for whatever is left, batched, verified the same way | cents |
| 4 | homepage check for hospitals still unresolved → `site-found` | free |
| 5 | **state corroboration**: probe each matched MRF header, compare `license_number\|<ST>` to the hospital's state | free |
| 6 | **adjudication**: `lib/adjudicate.js` on any name match under 0.85 | cents |

Phases 5 and 6 are not optional polish, they are the difference between a
worklist and garbage. Measured on the real 1,283-hospital gap list:

- 181 rows passed the name match at the 0.55 threshold
- state corroboration demoted **66** of them - `TEXAS COUNTY MEMORIAL HOSPITAL` (MO) had
  matched `Texas Health Arlington Memorial Hospital`, and two different Kentucky
  hospitals had both matched the same generic `University Hospital` entry
- adjudication dropped **13** more that were in-state but the wrong facility -
  `Ochsner Lafayette General` vs `Ochsner Medical Center - Kenner`,
  `Essentia Health Duluth` vs `Essentia Health-Ada`, three Baylor Scott & White
  facilities in different cities

Final: **102 verified** (real `cms-hpt.txt` that names the hospital, plus a live
`mrf_url`), 79 `unconfirmed` for manual review, 351 `site-found` (website
confirmed, no pointer file - hand those to `recover --llm`), 751 `none`.

State corroboration also fills in `mrf_last_updated` and `cms_version` for free, so
newly-found hospitals arrive with their compliance status already known.

```bash
node scripts/hpt/find-domains.js --limit 25        # trial
node scripts/hpt/find-domains.js                   # full list, ~45 min
node scripts/hpt/find-domains.js --free --retry-status=none --no-heuristics
node scripts/hpt/find-domains.js --search --retry-status=none --no-heuristics
node scripts/hpt/run.js gaps --import=data/hpt-audit/found_domains.csv
```

The `--free` command makes one bulk Wikidata request and tests its official-site
domains only against cached `none` rows. It needs no key and makes no
per-hospital search request. The next command is the higher-recall search-provider
pass for anything still missing. Both avoid repeating the already-failed slug
guesses. The final command imports the `verified` and `site-found` domains into
the main tracker.
`unconfirmed` rows deliberately have a blank `resolved_domain` and are not
imported without manual review. Configure search with
`HPT_SEARCH=serper|decodo|exa` and that provider's credentials.

Two things worth knowing. Hospitals already in `cms_data/outreach.json` are
skipped by default (`--include-known` to override) because the gap list goes
stale against fieldwork done by hand. And the DNS pre-check uses `dns.Resolver`,
never `dns.lookup`: the OS resolver ignores timeouts and measured 11 seconds per
NXDOMAIN, worse than the HTTP request it replaces; c-ares with a 1.5s timeout
does the same lookup in ~20ms and takes the pass from hours to minutes.

The finder itself does not write the manifest, `domains.json`, or
`outreach.json`; its CSV is import-ready, and the explicit `gaps --import`
command is the step that updates `domains.json`.

## External link exports as leads - `verify-external-links.js`

An external CSV of public hospital links can improve discovery without making
the publisher's dataset part of this repository. The export is treated only as
a disposable lead source:

```bash
node scripts/hpt/verify-external-links.js --input="C:\path\to\export.csv" --limit=25
node scripts/hpt/verify-external-links.js --input="C:\path\to\export.csv"
# after reviewing cms_data/hpt/external_link_evidence.csv
node scripts/hpt/verify-external-links.js --input="C:\path\to\export.csv" --promote
node scripts/hpt/run.js pointers && node scripts/hpt/run.js match
```

Rows are tied to the CMS roster only by CCN or a unique exact normalized
hospital-name + state match. A public URL then supplies a candidate hospital
domain, but its file link is never trusted or imported. The verifier performs
fresh, direct requests and requires all of the following before a domain is
eligible for promotion:

1. the hospital homepage responds;
2. the domain publishes a valid `cms-hpt.txt` that strongly names the CMS
   hospital;
3. the MRF URL is rediscovered from that pointer file, not copied from the
   external export;
4. a ranged read reaches the MRF and its header's licensing state matches the
   CMS roster state.

Missing header state, weak names, conflicting domains, and pre-existing domain
assignments go to `external_link_review.csv` instead of being promoted. Explicit
state disagreement is rejected. `--promote` only adds unconflicted verified
CCN/domain assignments to `domains.json`; it never replaces an existing one.

The durable files are `external_link_evidence.csv` and
`external_link_verified_domains.csv`. Their URLs and metadata come from the
hospital site, `cms-hpt.txt`, the MRF response, and the CMS roster. The staging
candidate/unmapped CSVs and resumable cache are gitignored, so publisher labels,
rankings, counts, and other export fields do not enter the tracker.

## LLM footer recovery - `recover --llm`

The free `recover` pass greps the homepage for a link whose text or URL contains
`price`/`transparen`/`standard-charges`, then greps that page for a `.csv`/`.json`
link. It misses whenever the nav label is "Patient Financial Resources", the menu
is script-built, or the file sits two hops in.

`recover --llm` keeps the same input set (a working site, no `cms-hpt.txt`, not
blocked, not already resolved by the regex pass) and the same premise, but drives
the two hops with a model: *which nav links lead to the price page*, then *which
link on those pages is the machine-readable file*. It reads the smallest domains
first - a real system almost always has a pointer file, so a pointer-less domain
is usually one hospital that linked its file straight off its own site.

The safety-critical part is what happens next. A scraped link is weaker evidence
than a hospital-declared `mrf-url`, so every candidate goes through the header
probe and the **same corroboration gate the `match` stage uses**:

| header evidence | outcome |
|---|---|
| `license_number\|<ST>` equals the hospital's state | accept (high) |
| `license_number\|<ST>` names a different state | **reject** |
| no state, but `hospital_name` ≈ roster name (≥ 0.6) | accept (medium) |
| single-hospital domain, file just carries a valid CMS date | accept (low) |
| anything else | left `unconfirmed` for manual review |

Accepted rows are written to `recovered.csv` in manifest column order.
`recovered_mrfs.json` keeps the full record including every rejected and
unconfirmed URL with its reason. **Neither is merged into the manifest
automatically** - review `recovered.csv`, then feed the good rows in the same way
as a `gaps` import. Needs `OPENROUTER_API_KEY`; `OPENROUTER_MODEL` optional
(defaults to `meta-llama/llama-3.1-8b-instruct`, same as `adjudicate`). Nothing
here reaches a paid unblocker.

## Outreach draft queue - `outreach-prep.js`

`node scripts/hpt/outreach-prep.js` turns the actionable rows of
`compliance.csv` into a review queue for the `outreach` skill. For each hospital
with a `stale`, `old-template`, `broken-link`, `no-pointer` or `pointer-no-mrf`
finding it:

1. classifies the finding into an email variant (deterministic);
2. fetches the price page plus a couple of contact pages, scrapes every
   `mailto:`, and asks a model for the best billing / price-transparency address
   - returning one only if it actually appeared on a page;
3. renders a draft from the `outreach` skill's template, optionally rewriting the
   one finding-specific paragraph with the model, then lints it (salutation is
   `Hello,`, no em dash, the 30-day follow-up line is present).

Output is `outreach_queue.csv`. The script **never sends email and never writes
`cms_data/outreach.json`** - logging stays a confirmed step in the `outreach`
skill. It runs without an API key (contact falls back to the first on-domain
`mailto:`, drafts fall back to the template). Signature block comes from
`--name` / `--email` / `--url` or `HPT_OUTREACH_NAME` / `_EMAIL` / `_URL`.

## The output CSV

Everything lands in one row per hospital in `cms_data/hpt/manifest.csv`
(`manifest.json` has the same rows). `match` writes the identity and URL columns;
`dates` fills the rest, and the two can run in either order.

| Column | Meaning |
|---|---|
| `ccn` | CMS Certification Number - joins to `Facility ID` in the CMS datasets |
| `hospital_name`, `city`, `state`, `type` | From `Hospital_General_Information.csv` |
| `domain` | Host the pointer file was found on |
| `pointer_url`, `pointer_via` | The `cms-hpt.txt` URL, and how it was fetched (`direct` / `redirect` / `verify` / provider) |
| `location_name` | The name **as the hospital wrote it** in its pointer file |
| `mrf_url` | The machine-readable file URL |
| `source_page_url` | The hospital's price-transparency page |
| `extra_mrf_urls` | Additional MRF URLs on the same entry, `\|`-separated |
| `mrf_format` | Format guessed from the URL |
| `match_score`, `match_method` | How the entry was tied to this CCN (`name` / `sole-candidate` / `global-name` / `global-name+corroborated` / `llm-adjudicated`) |
| `match_corroboration` | The evidence that settled a cross-state or adjudicated match |
| `mrf_last_updated` | **Date of record** - the file's own `last_updated_on`, ISO |
| `mrf_last_updated_raw` | That value exactly as published (e.g. `3/27/2026`) |
| `mrf_date_source` | `file-metadata`, or blank when undated |
| `mrf_days_since_update` | Age in days |
| `mrf_stale_over_365` | `yes` / `no` - 45 CFR 180.50 requires annual updates |
| `mrf_cms_version` | CMS template version, normalized (`V3.0.0` → `3.0.0`) |
| `mrf_bytes`, `mrf_content_type` | From the response headers |
| `mrf_file_kind` | Real type from magic bytes (`csv` / `json` / `zip` / `gzip`), not the extension |
| `mrf_http_status`, `mrf_checked_at` | Probe result and timestamp |
| `mrf_http_last_modified_diagnostic` | **Diagnostic only** - never the date of record, see below |

Rows whose entry could not be tied to a hospital are not dropped; they go to
`unmatched.json` with the reason and the best rejected guess.

## How the update date is determined

`mrf_last_updated` comes from **one source only**: the `last_updated_on` field
inside the file itself, which CMS requires in the template. Nothing else is
substituted for it.

HTTP `Last-Modified` is deliberately *not* used as the date of record. Measured
across 726 files that had both:

| | |
|---|---|
| HTTP later than declared | 561 |
| HTTP **earlier** than declared | 111 |
| identical | 54 |
| drift (days) | min −19, median 23, max 249 |

A timestamp that predates the content date in 111 cases is not tracking content
- it tracks when the bytes were deployed, and it moves on CDN re-uploads, site
migrations and cache refreshes. It is still recorded, as
`mrf_http_last_modified_diagnostic`, because the gap between the two is a useful
signal. It never fills `mrf_last_updated`, and rows with no declared date are
left blank rather than padded with a plausible-looking wrong one.

Reading the date does not require downloading the file. The CMS template puts
the metadata first, so a ranged request for the first 16 KB is enough - on a
120-URL sample this dated **91%** of files while transferring a few KB each
instead of the ~166 MB average. Compressed MRFs (`.zip`, `.gz`) pull a 256 KB
window and inflate just the header, which recovers dates that would otherwise be
unreadable.


### Auditing the matches

Every MRF header declares the hospital's own licensing state, which gives an
independent check on matches that were made by name. Run it against the manifest:

```bash
node -e "const m=require('./cms_data/hpt/manifest.json'),d=require('./cms_data/hpt/mrf_dates.json');let a=0,b=0;for(const r of m){const p=d[r.mrf_url];if(!p||!p.mrfLicenseState)continue;p.mrfLicenseState===r.state?a++:b++}console.log(a+'/'+(a+b)+' agree, '+b+' disagree')"
```

This audit is what drove the current rules. The first version matched 96.7%, and
**every** error sat in the per-domain pass, which had no state check at all: a
system like Providence lists 61 locations across many states, so a within-domain
name match happily landed `PROVIDENCE ST JOSEPH HOSPITAL (CA)` on a Washington
file. Applying the header state to *all* match paths - not just the cross-state
ones - took it to **1,014/1,014**, at a cost of 0.6 points of coverage. Under a
precision-first manifest that is the right trade: a wrong CCN→MRF row silently
corrupts any downstream pricing analysis, while a missing one is visible in
`gaps.csv`.

## Disk space

MRFs are large. A 4-file sample averaged **166 MB** each (134 MB / 353 MB / 1 MB /
177 MB). Full national coverage is plausibly in the **hundreds of gigabytes**.
Downloads stream to disk rather than buffering, so memory stays flat, but plan
storage before running `download` without `--limit`.

## Known gaps

- **Federal hospitals** (VA, DoD - 164 in the roster) are outside 45 CFR 180, so
  they have no pointer file to find. `seed` reports them and `resolve` skips them
  by default.
- **`entry_date` on the seed dataset is 2022**, so its deep URLs are stale. It is
  used only for *domain* discovery; every pointer file is fetched fresh.
