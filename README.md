# CMS Hospital Price Transparency Tracker

Finds the machine-readable standard-charges file that every US hospital is
required to publish under 45 CFR 180, records when each was last updated, and
reports who publishes, who is stale, and who blocks automated access.

Covers the full CMS registry of **5,419 hospitals**.

```bash
npm install
node scripts/hpt/run.js          # list every stage
```

New to this? Start with [`scripts/hpt/readme.txt`](scripts/hpt/readme.txt),
which explains the whole thing in plain English. The technical detail is in
[`scripts/hpt/README.md`](scripts/hpt/README.md).

## The problem

The CMS hospital registry has names and street addresses but **no website
column**. So we know exactly what to look for and have no idea where to look.
Finding the domains is the entire job.

The rules require a pointer file at a fixed location:

```
https://thehospital.com/cms-hpt.txt
```

That file lists the locations it covers **by name**, so it identifies itself.
A guessed domain can therefore be confirmed or discarded for the price of one
free request, which is why cheap candidate sources beat paid search here.

## Layout

```
scripts/hpt/          the pipeline (self-contained; Node built-ins + dotenv)
  run.js              CLI: every stage
  lib/                fetching, parsing, probing, search, LLM adjudication, audit
scripts/build-tracker.js   injects the CSVs into tracker.html
tracker.html          hand-authored page; the build swaps its data block
js/tracker.js  js/outreach.js   loaded by the page (must sit alongside it)
mrf.html rules.html pointer.html   the explainer pages (see below)
css/docs.css  js/docs.js          shared by the explainers only
data/hpt-audit/       the CSV snapshot the page is built from
cms_data/             the CMS roster (committed; see below)
```

`tracker.html` is **source, not output**. The build reads it, replaces the
`<script id="tracker-data">` payload, and stamps cache-busting hashes on the
page scripts. Editing the page means editing that file.

## The explainer pages

Three static pages, linked from the tracker's masthead, covering what the
tracker measures and why:

| Page | Covers |
| --- | --- |
| [`mrf.html`](mrf.html) | What a machine-readable file is: the five standard charge types, the three CMS template layouts, the full data dictionary, and the allowed-amount rules for charges that aren't dollar figures |
| [`rules.html`](rules.html) | 45 CFR 180 end to end: scope and exemptions, both disclosure duties, the 2021&ndash;2026 compliance timeline, enforcement and penalty arithmetic, and which paragraph each audit finding rests on |
| [`pointer.html`](pointer.html) | `cms-hpt.txt` &mdash; the required fields, worked examples, the naming convention, and how the crawl uses it to resolve domains |

Every regulatory claim links to its paragraph in the eCFR, and each page ends
with a numbered source list keyed to inline `[n]` markers. Sources are the
current [45 CFR 180](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-E/part-180),
the Federal Register final rules that amended it, and CMS's
[technical implementation guide](https://github.com/CMSgov/hospital-price-transparency).

These pages carry a **verbatim copy of the tracker's design tokens** in
`css/docs.css`, because `tracker.html` keeps its CSS inline so the build can
ship it as one self-contained file. Change a token in one and change it in the
other. Snapshot figures quoted in the prose are dated and do not update with a
rebuild &mdash; they need editing by hand when the numbers move.

The masthead links between these pages are relative, so `--standalone` and
`--artifact` builds strip them; both outputs travel without their siblings.

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
node scripts/build-tracker.js
npm run serve      # http://localhost:8081/tracker.html
```

`data/hpt-audit/` is a deliberate snapshot, so the published page does not
change every time the pipeline runs. It must be refreshed explicitly.

### Outreach notes with persistence

`npm run serve` is a plain static server — the outreach notes UI (status,
follow-ups, emails logged, corrections) falls back to that browser's
`localStorage`, per-browser only. To persist those to a shared file instead:

```bash
npm run serve:outreach   # http://localhost:8080/tracker.html
```

Run one or the other, never both. `serve:outreach` serves the page *and* the
API, so it fully replaces `serve`. They deliberately sit on different ports:
sharing one let each grab a different address family (IPv4 vs IPv6) instead of
failing with `EADDRINUSE`, so whether the page found the API came down to how
`localhost` happened to resolve.

This backs `js/outreach.js`'s `/api/outreach*` calls and writes everything to
`cms_data/outreach.json`, so notes survive across browsers and machines that
hit the same server. No dependencies beyond Node itself.

## The CMS roster

`cms_data/Hospital_General_Information.csv` — the Hospital General Information
table from the CMS provider-data catalogue, and the input every run starts
from. It **is committed**, so the repo is self-contained and any published
result can be reproduced against the exact roster that produced it.

CMS revises the table on its own schedule. To refresh it, replace the file and
re-run `seed`; the hospital count in the reports will move with it.

What is *not* committed is the pipeline's working state under `cms_data/hpt/`:
that is all derived, and `cms_data/hpt/mrf/` in particular holds the downloaded
price files, which average 166 MB each and already total 664 MB locally.

## Configuration

All optional. With nothing set, the free paths still run to completion and
anything blocked is recorded for a later pass.

Put credentials in `.env.local`, which is gitignored:

```bash
HPT_SEARCH=serper                  # or: decodo | dataforseo | exa
SERPER_API_KEY=...                 # 2,500 free queries/month

OPENROUTER_API_KEY=...             # adjudicates ambiguous name matches
OPENROUTER_MODEL=~deepseek/deepseek-v4-flash-latest

HPT_UNBLOCKER=decodo               # or: oxylabs
DECODO_USERNAME=...
DECODO_PASSWORD=...
```

## Correctness

Hospital names repeat across states, so no match rests on a name alone. Every
one is corroborated against the street address and `license_number|<ST>`
licensing state carried **inside** the MRF header, read via a ranged request
rather than downloading files that average 166 MB.

```bash
node scripts/hpt/run.js audit
```

`audit` exits non-zero if any output row asserts something its own fields
refute — a hospital reported as having no domain while holding a pointer URL,
a row called compliant with no file link, a stale flag disagreeing with its own
day count. It found four such classes affecting roughly 1,200 rows.

The compliance report keeps a hard line between **"this hospital did not
publish"** and **"we could not find it"**. Only the former is a finding;
unresolved hospitals are marked `not-assessed` and excluded from every finding
count. Conflating the two would make the numbers several times worse than
reality.

## License

[GNU Affero General Public License v3.0](LICENSE).

AGPL rather than GPL because of section 13. This is a tracker meant to be
*served*, and the ordinary GPL lets someone run a modified copy on a public
server without ever releasing the changes. Section 13 closes that: if you deploy
a modified version where others can reach it over a network, you owe its users
the corresponding source. Fork it, host it, point it at a different registry —
just pass on the same freedoms.

`tracker.html` carries the notice and a source link in its footer, which is what
discharges that obligation for a deployed page. Keep them there if you host your
own build.

The license covers **this code, not the data it reports on**.
`cms_data/Hospital_General_Information.csv` is a US government work from the CMS
provider-data catalogue, and the `cms-hpt.txt` and standard-charges files belong
to the hospitals that published them. Neither becomes AGPL by passing through
here.

Built by [anthonyisnotadev](https://github.com/anthonyisnotadev).
