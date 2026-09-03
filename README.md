# CMS Hospital Price Transparency Tracker

### 🔴 Live at [mrf.anthonyisnota.dev](https://mrf.anthonyisnota.dev)

Finds the machine-readable standard-charges file that every US hospital is
required to publish under 45 CFR 180, records when each was last updated, and
reports who publishes, who is stale, and who blocks automated access.

Covers the full CMS registry of **5,419 hospitals**.

---

## What this is

Every hospital in the United States is required by law to publish its prices
in a file that computers can read. This tool finds those files.

It starts from the official CMS list of 5,419 hospitals and, for each one,
tries to answer three questions:

1. What is this hospital's website?
2. Where is its price file?
3. When was that price file last updated?

The answers go into a spreadsheet you can open in Excel.

---

## Why it is harder than it sounds

The government's hospital list does not include website addresses. It has
names and street addresses and nothing else.

So we know exactly what we are looking for, and have no idea where to look.
Finding the websites IS the job. Everything else follows easily once you
know a hospital's web address.

---

## How it works

The rules say a hospital must put a small text file at its web address, at
a fixed spot:

```
https://thehospital.com/cms-hpt.txt
```

That little file says "here is where my price list lives."

The useful part: that file also lists WHICH hospitals it covers, by name. So
it identifies itself. That means we can simply guess a web address, look for
the file, and let the file tell us whether we guessed right. A wrong guess
costs nothing but a moment.

That single fact shapes everything:

- We do not need an expensive search service. Cheap guesses work, because
  every guess gets checked for free.
- Guesses come from several places: an open dataset of known price-file
  links, Wikidata, a web search, and the files of other hospitals.
- Large hospital chains list every hospital they own in one file. The file
  at encompasshealth.com names 185 hospitals. One lucky guess can answer the
  question for dozens of hospitals at once.

---

## The hard part: making sure it is the right hospital

Hospital names repeat constantly. There is a "St. Mary's Hospital" in many
different states. There are three hospitals named "Mercy Regional Medical
Center." Matching on the name alone produces wrong answers that look right.

Two things prevent that:

1. Every price file contains the hospital's own street address and the state
   it is licensed in. We read that and check it agrees. If a file says
   Virginia and the hospital is in Arizona, it is not a match, no matter how
   well the names line up.
2. Hospitals get bought and renamed. "Baptist Health Shelby Hospital" is the
   same building as "SHELBY BAPTIST MEDICAL CENTER" after a change of owner.
   Names like that are sent to an AI, which is given the addresses and asked
   whether it is the same place. Only confident yes answers are accepted.

Everything in the final spreadsheet was checked against the address inside
the price file. At the last check, 1,237 out of 1,237 checkable rows agreed.

---

## What you get

Three spreadsheets, in the folder `cms_data/hpt/`:

- **`manifest.csv`** &mdash; the answer. One row per hospital: its website,
  its price file link, and when that file was last updated. 3,486 hospitals
  so far.
- **`compliance.csv`** &mdash; who is following the rules and who is not.
  Every hospital is labelled with what we observed and the evidence for it.
- **`gaps.csv`** &mdash; the hospitals we could not resolve, each labelled
  with what would fix it, so the remaining work can be handed off or done
  later.

---

## What we found

Of 5,419 hospitals:

| | |
| ---: | --- |
| 3,486 | price file found and confirmed (64%) |
| 2,841 | of those also have a last-updated date |
| 1,933 | not resolved yet (36%) |
| &nbsp;&nbsp;164 | of those are federal hospitals (VA and military), which the rules exempt, so they have no file to find in the first place |

We could actually assess 3,629 hospitals. Of those, 2,908 were publishing
their prices (2,473 of them with a confirmed date; for the other 435 the file
was there but its date could not be read), and 721 had a problem:

| | |
| ---: | --- |
| 278 | price file link is broken |
| 121 | price file more than a year old (the rules require yearly updates) |
| 119 | website refuses automated visitors on the price-file location |
| 93 | file uses an outdated government template |
| 67 | website refuses automated visitors on the price file itself |
| 37 | publishes no price-file pointer at all, though the site works |
| 6 | pointer file names the hospital but gives no link to its price file |

The blocking is concentrated. Two hospital chains account for 68 of the 186
blocked hospitals, across 78 domains in total.

A further 379 hospitals sit in their own category: we found a working price
file on their health system's website, but that file does not mention them.
Either the system left them out, or our name matching missed them. Because
we cannot tell which, they are reported as "not named in file" rather than
counted against the hospital.

---

## An important distinction

The report carefully separates two different things:

> "This hospital did not publish its prices." &mdash; a finding about them
>
> "We could not find this hospital's website." &mdash; a gap in our own work

Only the first is reported as a problem. About 1,600 hospitals fall into the
second group, and they are marked "not assessed" rather than counted as
breaking the rules. Mixing those two together would have made the numbers
look several times worse than reality and the report worthless.

---

## How to run it

You need Node.js installed. From the project folder:

```bash
node scripts/hpt/run.js seed          # prepare the hospital list
node scripts/hpt/run.js pointers      # look for price files
node scripts/hpt/run.js match         # work out which file belongs to whom
node scripts/hpt/run.js dates         # find when each file was updated
node scripts/hpt/run.js compliance    # produce the compliance spreadsheet
node scripts/hpt/run.js audit         # check the results contradict nothing
node scripts/hpt/run.js report        # show a summary
```

Every step can be stopped and restarted. It remembers what it already did
and picks up where it left off. Nothing is lost if you close the window.

### Building and joining the `cms-hpt.txt` corpus

The pointer corpus is generated locally and gitignored. It downloads only the
small `cms-hpt.txt` pointer files, never the large MRF files they reference:

```bash
npm run hpt:pointers:corpus
npm run hpt:combine-corpus
```

The second command performs a full outer join between the current manifest
(`cms_data/hpt/manifest.csv` when present, otherwise the published
`data/hpt-audit/manifest.csv`) and the corpus. Its output is
`cms_data/hpt/pointer-corpus/cms_hpt_full_database.csv`.

The join uses only `matched_ccns`, which are exact MRF-URL links. It never
promotes pointer-level `related_ccns` into facility matches. Duplicate CCNs
are disambiguated with the normalized MRF URL when possible and otherwise
labeled `ambiguous-duplicate-ccn`. Both database-only hospitals and unmatched
corpus entries remain in the file. Override paths when needed:

```bash
npm run hpt:combine-corpus -- --manifest=path/to/manifest.csv --corpus=path/to/cms_hpt_entries.csv --out=path/to/combined.csv
```

External CCN/MRF link inventories have a conservative path for unresolved
hospitals. `npm run hpt:direct-mrf:prepare -- --input=path/to/links.csv` stages
current-roster CCN/URL claims, and `npm run hpt:direct-mrf:headers` probes each
unique MRF with capped requests. Claims are imported only when the MRF header
independently confirms the same facility; full MRF downloads are not part of
these commands.

For the full list of steps and options, run `node scripts/hpt/run.js` with
no arguments. The exact command sequence used so far, including the paid
fallback paths, is under [Running it](#running-it) below.

---

## What it costs

Almost nothing. The work so far cost about zero dollars: the web searches fit
inside a free allowance, and the AI checking cost a few cents.

Fetching the price files themselves is free. Note that the price files are
large, often 100 to 300 megabytes each, so downloading all of them would need
a lot of disk space. This tool reads only the first few kilobytes of each
file to get the date, which avoids that entirely.

---

## Limits, honestly

100% is not achievable. Some hospitals genuinely do not publish these files,
federal hospitals are exempt, and some websites cannot be reached at all. The
realistic ceiling is somewhere in the high eighties as a percentage of
hospitals that actually have a file to find.

The remaining work is known and listed in `gaps.csv`. Most of it needs either
a fresh month of free web searches or a service that can get past sites which
block automated visitors.

---

## Technical details

For anyone running the pipeline or working on the code. Full pipeline
reference: [`scripts/hpt/README.md`](scripts/hpt/README.md).

```bash
npm install
node scripts/hpt/run.js          # list every stage
```

---

## Layout

```
scripts/hpt/          the pipeline (self-contained; Node built-ins + dotenv)
  run.js              CLI: every stage
  lib/                fetching, parsing, probing, search, LLM adjudication, audit
  geocode.js          one-off: roster addresses -> coords.json (see below)
scripts/build-tracker.js   injects the CSVs and the stylesheets into tracker.html
scripts/build-glossary.js  updates any explainer page that opts into the glossary
tracker.html          hand-authored page; the build swaps its data block
js/tracker.js  js/outreach.js   loaded by the page (must sit alongside it)
mrf.html rules.html pointer.html skill.html   the explainer pages (see below)
css/docs.css  js/docs.js          shared by the explainers only
.claude/skills/outreach/SKILL.md   the agent skill; documented by skill.html
data/hpt-audit/       the CSV snapshot the page is built from
cms_data/             the CMS roster (committed; see below)
```

`tracker.html` is **source, not output**. The build reads it, replaces the
`<script id="tracker-data">` payload, and stamps cache-busting hashes on the
page scripts. Edit the page by editing that file.

---

## The explainer pages

Four static pages, linked from the tracker's masthead:

| Page | Covers |
| --- | --- |
| [`mrf.html`](mrf.html) | What a machine-readable file is: the five charge types, the three CMS template layouts, the data dictionary, allowed-amount rules |
| [`rules.html`](rules.html) | 45 CFR 180 end to end: scope, exemptions, the compliance timeline, enforcement and penalties |
| [`pointer.html`](pointer.html) | `cms-hpt.txt`: required fields, worked examples, naming convention |
| [`skill.html`](skill.html) | The `outreach` agent skill: what it does, a worked example, running it in other agent runtimes |

Notes for editing them:

- Each of the first three opens with a **short version** (four plain
  sentences) before the regulatory detail.
- Explainer pages can opt into the shared glossary with its HTML sentinels.
  Definitions live in `TERMS` in
  [`scripts/build-glossary.js`](scripts/build-glossary.js); the current concise
  pages do not need glossary entries.
- Every regulatory claim links to its paragraph in the eCFR, with a numbered
  source list at the foot of the page. Sources: the current
  [45 CFR 180](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-E/part-180),
  the Federal Register rules that amended it, and CMS's
  [technical implementation guide](https://github.com/CMSgov/hospital-price-transparency).
- `css/docs.css` carries a **verbatim copy of the tracker's design tokens**
  (`tracker.html` keeps its CSS inline instead of importing this file) —
  change a token in one, change it in the other. Snapshot figures in the
  prose are dated by hand and don't update on rebuild.
- The masthead links between pages are relative and get stripped from
  `--standalone`/`--artifact` builds, which travel without their siblings.

---

## Running it

```bash
# free: everything discoverable without spending anything
node scripts/hpt/run.js seed
node scripts/hpt/run.js pointers
node scripts/hpt/run.js match
node scripts/hpt/run.js candidates --source=wikidata
node scripts/hpt/run.js candidates --source=orphan
node scripts/hpt/run.js verify
node scripts/hpt/run.js corroborate
node scripts/hpt/run.js match

# then the cheap paths for whatever is still missing
node scripts/hpt/run.js candidates --source=search   # Serper free tier
node scripts/hpt/run.js verify
node scripts/hpt/run.js adjudicate                   # cents
node scripts/hpt/run.js match

node scripts/hpt/run.js dates
node scripts/hpt/run.js compliance
node scripts/hpt/run.js audit
```

Every stage is resumable — re-running skips work already recorded.

### Publishing the page

```bash
cp cms_data/hpt/{compliance,manifest,gaps}.csv data/hpt-audit/
npm run build      # validate explainers, then embed data + CSS in the tracker
npm run serve      # http://localhost:8081/tracker.html
```

`data/hpt-audit/` is a deliberate snapshot, so the published page does not
change every time the pipeline runs. It must be refreshed explicitly.

### Protecting raw pointer contacts

The raw `cms-hpt.txt` files include public `contact-name` and `contact-email`
fields. To keep those values from being searchable in the working tree while
retaining the source files, encrypt only those fields in place:

```bash
npm run obfuscate:pointers
npm run check:pointers-private
```

The retained snapshot lives in `data/hpt-audit/pointers/`. The first command
generates an AES-256-GCM key at
`data/hpt-audit/.pointer-obfuscation-key`. The key and verification report are
intentionally tracked so every clone can verify and decode the contacts locally.
This is search-engine obfuscation, not secret encryption: anyone with the
repository can use the included key and script to recover the values. Plaintext
contacts are not checked in. Once the key exists, later `pointers` and `verify`
runs automatically protect newly written raw files before they are copied into
the retained snapshot.

Both `npm run serve` and `npm run serve:outreach` bind to the local machine and
decrypt protected pointer-file responses in memory. They never write plaintext
contacts back to disk, and they refuse HTTP access to the key and private
outreach files. To restore plaintext files deliberately, run
`node scripts/hpt/obfuscate-pointers.js --restore`.

### Hospital coordinates

Each hospital's outreach panel draws a small [OpenFreeMap](https://openfreemap.org/)
map of where it is. CMS gives a postal address and nothing else, so the
coordinates are resolved once, offline, and committed as
`cms_data/hpt/coords.json`:

```bash
npm run geocode                                              # street addresses
npm run geocode -- --retry --benchmark Public_AR_Census2020  # rural misses
npm run geocode -- --zip-only                                # the rest, by ZIP
```

Source: the **US Census batch geocoder** — public domain, no key needed, and
built for bulk US address files (Nominatim's usage policy forbids that use).
The three passes place 4,736 hospitals at their address, 650 more at their
ZIP code's centre (labeled as such, zoomed out), and leave 33 unplaced
because their ZIPs are PO boxes with no mappable area — those just get no map.

Regenerate the file only when the roster gains hospitals. The build warns
and carries on without maps if it's missing.

### Outreach notes with persistence

`npm run serve` does not expose an outreach write API, so the outreach notes UI
(status, follow-ups, emails logged, corrections) falls back to that browser's
`localStorage` — per-browser only. To persist notes to a shared file instead:

```bash
npm run serve:outreach   # http://localhost:8080/tracker.html
```

Run one or the other, never both — `serve:outreach` serves the page *and*
the `/api/outreach*` API that `js/outreach.js` calls, writing everything to
`cms_data/outreach.json` so notes survive across browsers and machines. No
dependencies beyond Node itself. (It uses a different port than `serve`
deliberately, to avoid a port conflict between the two.)

### Logging outreach from the command line, or from an agent

The same records are writable without the browser. `scripts/outreach-cli.js` is
the validating write surface — dry run by default, all-or-nothing batches, a
one-deep backup, and a `discarded:` line for every field it drops:

```bash
node scripts/outreach-cli.js help
node scripts/outreach-cli.js find "st anthony summit" --state CO
node scripts/outreach-cli.js apply plan.json          # dry run
node scripts/outreach-cli.js apply plan.json --commit
```

`.claude/skills/outreach/SKILL.md` teaches an agent to drive that CLI from a
plain description of what you did — *"I emailed them and it bounced"* — and to
show you the diff before anything is written. It is an
[Agent Skills](https://agentskills.io/specification) file, so it also loads in
OpenCode (which reads `.claude/skills/` directly), and in Codex, Cursor and
Gemini CLI via a symlink into `.agents/skills/`.

[`skill.html`](skill.html) is the full write-up: worked examples, guardrails,
per-runtime paths, and what changes when you point a different model at it.

---

## The CMS roster

`cms_data/Hospital_General_Information.csv` is the CMS provider-data
catalogue's Hospital General Information table — the input every run starts
from. It **is committed**, so any published result can be reproduced against
the exact roster that produced it.

CMS revises the table on its own schedule. To refresh it: replace the file,
re-run `seed`. The hospital count in the reports moves with it.

*Not* committed: the pipeline's working state under `cms_data/hpt/`. That's
all derived — `cms_data/hpt/mrf/` in particular holds the downloaded price
files, which average 166 MB each and already total 664 MB locally.

---

## Configuration

All optional. With nothing set, the free paths still run to completion and
anything blocked is recorded for a later pass.

Put credentials in `.env.local`, which is gitignored. The runner reads `.env`
first and lets `.env.local` override it; both are ignored, and nothing here
encrypts either one, so live keys never belong in a commit:

```bash
HPT_SEARCH=serper                  # or: decodo | exa
SERPER_API_KEY=...                 # 2,500 free queries/month

OPENROUTER_API_KEY=...             # adjudicates ambiguous name matches
OPENROUTER_MODEL=~deepseek/deepseek-v4-flash-latest

HPT_UNBLOCKER=decodo               # or: oxylabs
DECODO_USERNAME=...
DECODO_PASSWORD=...
```

---

## Correctness

No match rests on a name alone — hospital names repeat across states. Every
match is corroborated against the street address and licensing state carried
**inside** the MRF header (read via a ranged request, not a full download).

```bash
node scripts/hpt/run.js audit
```

`audit` exits non-zero if any output row contradicts its own fields — e.g. a
hospital marked as having no domain while holding a pointer URL. It found
four such classes, affecting roughly 1,200 rows.

The compliance report keeps a hard line between **"this hospital did not
publish"** and **"we could not find it."** Only the former counts as a
finding; unresolved hospitals are marked `not-assessed` and excluded from
every finding count.

---

## License

[GNU Affero General Public License v3.0](LICENSE).

AGPL rather than GPL because of section 13: if you deploy a modified version
where others reach it over a network, you owe its users the source, not just
users who receive a copy of the binary. Fork it, host it, point it at a
different registry — just pass on the same freedoms.

`tracker.html` carries the notice and a source link in its footer to satisfy
that. Keep them there if you host your own build.

The license covers **this code, not the data it reports on**.
`cms_data/Hospital_General_Information.csv` is a US government work from CMS,
and the `cms-hpt.txt`/standard-charges files belong to the hospitals that
published them.

Built by [anthonyisnotadev](https://github.com/anthonyisnotadev).
