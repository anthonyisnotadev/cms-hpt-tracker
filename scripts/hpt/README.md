# CMS-HPT harvester

Finds and downloads the `cms-hpt.txt` pointer file — and the machine-readable
files (MRFs) it points to — for every hospital in `cms_data/Hospital_General_Information.csv`
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
   an operator owns — `encompasshealth.com` returns 185 of them, `providence.org`
   61. Fetching 150 domains produced pointer data for **1,215 hospitals**. Work
   is therefore scheduled per *domain*, highest hospital-count first.

## Pipeline

Each stage is resumable — re-running skips anything already recorded — and all
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

`match`, `corroborate` and `adjudicate` form a loop: each pass surfaces work for
the next, so re-running `match` after either stage is expected and cheap.

`--retryFailed` on `dates` re-probes anything without a declared date — including
records probed before compressed files could be read — rather than trusting a
stored success flag.

Useful flags: `--limit=N` (trial run), `--concurrency=N`, `--retryFailed`,
`--noUnblocker` (never spend money), `--maxMb=N` (skip MRFs larger than N MB,
default 512).

## Candidates and verification

Domain discovery does not need an accurate source, because **`cms-hpt.txt`
verifies itself**: the file lists its own location names, so a candidate can be
confirmed or discarded for the price of one HTTP request. Candidate *precision*
is therefore irrelevant — only recall and cost matter.

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
| Heuristic name guesses | **9%** — below the 15% bar, not run by default | free but ~12 requests/hospital |

The heuristic generator stays available behind `--source=heuristic` as a last
resort: it costs nothing but bandwidth, and every hit it produced scored 1.00.

## How a name is matched to a CCN

Names alone are not enough — `ST. MARY'S HOSPITAL` scores 1.00 against a
hospital in another state — so matching climbs a ladder of evidence and stops at
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
candidate rather than abandoning the entry — otherwise a cross-state collision
would knock out the correct in-state hospital.

## Where the pointer file can live

CMS permits the site root **or** `.well-known`, and both apex and `www`. All four
are tried, plus a homepage-redirect retry that catches systems which have merged
since the seed data was collected — `mercyhealth.com` now redirects to
`trinityhealthmichigan.org`, `memorial.org` to `commonspirit.org`.

## Unblocker

Only reached after a domain actually refuses the free request. Oxylabs and Decodo
both expose a realtime scrape endpoint with the same request/response shape, so
one adapter covers either:

```bash
HPT_SEARCH=serper           # or: decodo | dataforseo | exa
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
| `run-pointers-first` | nothing — run the free pass | not a gap yet, just unrun work |
| `name-match-review` | `adjudicate`, or manual | the pointer file already works; discovery is not the problem |
| `unblocker` | Decodo / Oxylabs | the domain is right and refusing us; a search returns the same host |
| `exempt-federal` | skip | VA/DoD are outside 45 CFR 180 |

Two things this prevents. Blocked hospitals are counted per *domain*, not per
hospital — 124 blocked hospitals were only 66 domains, so pricing them per
hospital overstates the work. And hospitals whose system publishes a working
pointer file are never sent to a search API, because the answer is already in
hand.

```bash
node scripts/hpt/run.js gaps                    # writes gaps.csv + gaps_<bucket>.csv
node scripts/hpt/run.js gaps --import=fixed.csv # read hand-corrected domains back
```

Each row has a blank `resolved_domain` column: fill it in by hand, import, then
re-run `pointers && match`. Nothing needs editing JSON directly.

## The output CSV

Everything lands in one row per hospital in `cms_data/hpt/manifest.csv`
(`manifest.json` has the same rows). `match` writes the identity and URL columns;
`dates` fills the rest, and the two can run in either order.

| Column | Meaning |
|---|---|
| `ccn` | CMS Certification Number — joins to `Facility ID` in the CMS datasets |
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
| `mrf_last_updated` | **Date of record** — the file's own `last_updated_on`, ISO |
| `mrf_last_updated_raw` | That value exactly as published (e.g. `3/27/2026`) |
| `mrf_date_source` | `file-metadata`, or blank when undated |
| `mrf_days_since_update` | Age in days |
| `mrf_stale_over_365` | `yes` / `no` — 45 CFR 180.50 requires annual updates |
| `mrf_cms_version` | CMS template version, normalized (`V3.0.0` → `3.0.0`) |
| `mrf_bytes`, `mrf_content_type` | From the response headers |
| `mrf_file_kind` | Real type from magic bytes (`csv` / `json` / `zip` / `gzip`), not the extension |
| `mrf_http_status`, `mrf_checked_at` | Probe result and timestamp |
| `mrf_http_last_modified_diagnostic` | **Diagnostic only** — never the date of record, see below |

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
— it tracks when the bytes were deployed, and it moves on CDN re-uploads, site
migrations and cache refreshes. It is still recorded, as
`mrf_http_last_modified_diagnostic`, because the gap between the two is a useful
signal. It never fills `mrf_last_updated`, and rows with no declared date are
left blank rather than padded with a plausible-looking wrong one.

Reading the date does not require downloading the file. The CMS template puts
the metadata first, so a ranged request for the first 16 KB is enough — on a
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
file. Applying the header state to *all* match paths — not just the cross-state
ones — took it to **1,014/1,014**, at a cost of 0.6 points of coverage. Under a
precision-first manifest that is the right trade: a wrong CCN→MRF row silently
corrupts any downstream pricing analysis, while a missing one is visible in
`gaps.csv`.

## Disk space

MRFs are large. A 4-file sample averaged **166 MB** each (134 MB / 353 MB / 1 MB /
177 MB). Full national coverage is plausibly in the **hundreds of gigabytes**.
Downloads stream to disk rather than buffering, so memory stays flat, but plan
storage before running `download` without `--limit`.

## Known gaps

- **Federal hospitals** (VA, DoD — 164 in the roster) are outside 45 CFR 180, so
  they have no pointer file to find. `seed` reports them and `resolve` skips them
  by default.
- **`entry_date` on the seed dataset is 2022**, so its deep URLs are stale. It is
  used only for *domain* discovery; every pointer file is fetched fresh.
