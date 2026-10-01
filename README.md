# CMS Hospital Price Transparency Tracker

> **Can you actually find what a hospital charges?**
> The law says hospitals must post their prices online. This project checks
> whether they did, and shows you what we found.

**[>> Open the live tracker <<](https://mrf.anthonyisnota.dev)**

```text
+------------------------------------------------------------------------+
| H O S P I T A L   P R O G R E S S                                      |
| COVERAGE / every CMS roster record is represented                      |
| Roster represented         [########################] 5,419  100.0%    |
+------------------------------------------------------------------------+
| REVIEW STATUS / one category per hospital                              |
|                                                                        |
| Active verification claim  [###############.........] 3,297   60.8%    |
| Standing evidence retained [###.....................]   762   14.1%    |
| Reviewed resolution        [###.....................]   622   11.5%    |
| Scope exception            [#.......................]   194    3.6%    |
| Unresolved investigation   [##......................]   544   10.0%    |
|                                                                        |
| Total                                                 5,419  100.0%    |
+------------------------------------------------------------------------+
| LOCAL SNAPSHOT  2026-09-29 02:46 UTC                                   |
| # = share of roster   . = remainder                                    |
| Review categories total 100%; they are not compliance scores.          |
+------------------------------------------------------------------------+
```

Local research snapshot; the live site may show an older published version.
The five review categories are mutually exclusive and account for all hospitals.
[Jump to the full progress report](#research-progress)

---

## The 30-second version

```text
      .-------------------.
      |  YOU, wondering   |
      |  "what will this  |
      |   MRI cost?"      |
      '---------+---------'
                |
                v
   .--------------------------.        .---------------------------.
   |  The law: hospitals must |  --->  |  Hospitals post a giant   |
   |  publish their prices    |        |  spreadsheet (an "MRF")   |
   '--------------------------'        '------------+--------------'
                                                     |
              but there are ~5,400 hospitals...      |
              and each hides it somewhere different  v
                                        .---------------------------.
                                        |   THIS PROJECT: go look,  |
                                        |   and write down what     |
                                        |   we find. (o_o)          |
                                        '---------------------------'
```

Most US hospitals must publish their prices in a computer-readable file. Those
files are public, but they are scattered across thousands of hospital websites
and are not always easy to locate.

This project walks through the **entire national list of hospitals**, one by
one, and records:

- **Where** the hospital's price file lives
- **Whether** it opens
- **When** it was last updated

Everything is available as a searchable website and as spreadsheets (CSV
files) for anyone who wants to dig in.

### What this project does NOT do

```text
   [x] Tell you whether a particular price is fair
   [x] Check every single price inside every file
   [x] Prove that a hospital broke the law
```

If a hospital shows up as "unresolved," that means **we could not confirm it
yet**, not that the hospital did something wrong. Websites move, block
automated visitors, or go down.

---

## Plain-English glossary

No healthcare background needed. Here are the only words you will meet:

| Word | What it really means |
| --- | --- |
| **CMS** | The federal agency (Centers for Medicare & Medicaid Services) that keeps the official hospital list and makes the rules |
| **MRF** | "Machine-readable file." The big spreadsheet where a hospital lists its prices |
| **`cms-hpt.txt`** | A tiny text file on a hospital's website that works like a **signpost**: "our prices are over there" |
| **CCN** | A hospital's official ID number, like a Social Security number for buildings |
| **Manifest** | Our table of "this hospital goes with this file," plus the proof |
| **Gap** | A hospital we still cannot account for |

---

## How we match a hospital to its price file

Finding a file is not enough. Many hospitals share the same name, health
systems share websites, and buildings change names when they get bought. So
every match has to **earn** its place:

```text
   [ Official CMS hospital list ]
                |
                v
   [ Find the hospital's website ]
                |
                v
   [ Find its signpost file (cms-hpt.txt) ]
                |
                v
   [ Follow the signpost to the price file ]
                |
                v
   [ Open the first few lines of the file and check:  ]
   [   "Is this really THE SAME hospital?"            ]
   [    address + ZIP + state + license number        ]
                |
        +-------+-------+
        |               |
        v               v
   MATCH CONFIRMED    STAYS IN REVIEW
      \(^o^)/            (-_-)?
```

A name alone never counts as proof. If anything looks ambiguous, the hospital
stays in review. The files are huge, so we peek at only the top of each one
instead of downloading the whole thing.

---

## Research progress

The dashboard above describes the local reviewed snapshot from September 29,
2026, 02:46 UTC (September 28 in US Eastern time). Finding and opening a file
does not check every price or establish legal compliance.

### Where all 5,419 hospitals stand

Each hospital sits in exactly one bucket. These buckets are **not** report
cards.

| Review category | Hospitals | What remains |
| --- | ---: | --- |
| Active verification claim | 3,297 | Keep dated file and identity evidence; stale dates or template concerns may still require follow-up |
| Standing evidence retained | 762 | Reconcile the newer observation without discarding stronger earlier evidence |
| Superseded by reviewed resolution | 622 | Preserve the earlier observation as history and use the reviewed resolution |
| Scope exception | 194 | Retain the documented reason for excluding the record from ordinary verification |
| Unresolved | 544 | Resolve discovery, access, pointer linkage, or facility identity using the per-CCN next action |

**In plain words:**

```text
   Evidence on file ........ 3,297  (the bulk of the list)
   Keeping the older proof ..  762
   Newer review replaced ....  622
   Special cases ............  194
   Still a mystery ..........  544  <-- the detective work is here
```

### What still needs work

The to-do list uses reviewed, hospital-by-hospital next steps. Right now,
**1,592 hospitals** have a recorded investigation, follow-up, or monitoring
step. Each hospital appears once below. These to-do groups overlap the buckets
above, so please do not add the two tables together. Only 544 are truly
unresolved.

| Next-step workstream | Hospitals |
| --- | ---: |
| Standing evidence follow-ups | 961 |
| Unresolved investigations | 544 |
| Uncertainty monitoring | 64 |
| Facility identity review | 10 |
| Finding reconciliation | 7 |
| Same-campus scope review | 5 |
| Other evidence review | 1 |

Completed scope exceptions do not automatically become "close as exempt"
tasks. A documented scope or identity follow-up can still remain for a record
with an existing result. These counts are generated for the website by
[`buildReviewedWorkQueue`](scripts/hpt/lib/tracker-work-queue.js) from its
source-validated reviewed worklists, using effective dispositions to exclude
investigations already resolved by overlays.

### Checklist

- [x] Put every hospital in the 5,419-record CMS list on the map
- [x] Give every hospital a review category
- [ ] Resolve the remaining 544 mystery cases
- [ ] Finish follow-up on retained evidence and outstanding file findings
- [ ] Review and publish the latest snapshot with privacy checks

Source: [`nationwide-verification.json`](data/hpt-audit/nationwide-verification.json),
with the reviewed overlays applied by
[`loadReviewedView`](scripts/hpt/lib/reviewed-resolutions.js). Next actions are
tracked in the
[`reconciliation queue`](data/hpt-audit/nationwide-reconciliation-queue.json).
Refresh this dated section after a reviewed snapshot changes; it is not a live
counter. An access error or unconfirmed website is not proof that a hospital
failed to publish.

For publication, run `npm run build` locally with the retained proof samples,
then `node scripts/check-tracker-release.js --write`. Commit the reviewed pages,
source inputs, and release manifest together. GitHub Pages checks their hashes
before deployment; it does not bypass proof validation or publish raw caches.

---

## The rules behind it (short version)

CMS Data Dictionary **3.0.0** is the current required MRF template. Its CY 2026
requirements took effect January 1, 2026, with CMS enforcement beginning April
1, 2026.

For each hospital the tracker asks five simple questions:

```text
   1. Did we find the hospital's website?              [ ]
   2. Does the site have the signpost file?            [ ]
   3. Does the signpost lead to a price file?          [ ]
   4. Does the file open, and name the right hospital? [ ]
   5. Was it updated within the last year?             [ ]
```

<details>
<summary>Fine print on template versions (for the curious)</summary>

An identity-matched file that clearly declares a 1.x or 2.x template does not
meet the current version requirement. A file declaring `3`, `3.0` or `3.00` is
read as the v3 template: these are formatting variants of 3.0.0, and the CMS
validator raises only an alert, not an error, for `3.0`. The alert stays in the
record's evidence, but the file is not flagged for its version. Other
non-3.0.0 literals (for example `3.0.1`, `4.0.0` or a date string) need source
review; an unread or missing version is unknown, and a 3.0.0 declaration alone
does not establish full-file compliance.

</details>

---

## Limitations

```text
   (!)  Some hospital websites block automated visitors.
   (!)  The official hospital list can lag behind closures,
        buyouts and name changes.
   (!)  One health-system file may not name every campus it covers.
   (!)  A file that opens can still contain incomplete or wrong prices.
   (!)  When a building's identity is unclear, a human has to decide.
```

## Explore the site

| Page | What you will find |
| --- | --- |
| [Tracker](tracker.html) | The main searchable table of hospitals |
| [Hospital price files](mrf.html) | What an MRF is, explained |
| [CMS rules](rules.html) | The rules hospitals must follow |
| [Pointer files](pointer.html) | The "signpost" file explained |
| [Outreach skill](skill.html) | How we log emails and fieldwork |

---

# For developers

Everything below is the technical manual. If you only wanted the story, you can
stop here. Thanks for reading! (^_^)/

## Published data

The reviewable snapshot is stored in `data/hpt-audit/`.

| Path | Contents |
| --- | --- |
| `manifest.csv` | Confirmed hospital, domain, pointer, MRF, date, and provenance records |
| `compliance.csv` | One assessment row per hospital |
| `gaps.csv` | Unresolved records and the next useful action |
| `pointers.json` | Stable, reduced JSON contract for downstream consumers |
| `pointers/` | Retained hospital `cms-hpt.txt` source files with contact fields obfuscated |
| `pointer-obfuscation.json` | Verification report for the retained pointer archive |

The tracker build embeds the three CSVs into `tracker.html`. The deployed Pages
artifact does not publish `data/` or the pipeline's working files as separate
web paths.

The working data under `cms_data/hpt/` is limited to:

- `roster.json`
- `domains.json`
- `coords.json`

`cms_data/Hospital_General_Information.csv` is the committed CMS roster used to
build those records.

Only `matched_ccns` are used as exact facility links during corpus imports.
`related_ccns` provide context for shared system pointers but do not establish a
match. MRF discovery normally requests only file metadata and a limited header
section with HEAD and Range requests.

## Install and view locally

Node.js 20.18 or newer is recommended.

```bash
npm ci
npm run build
npm run serve
```

Open `http://localhost:8081/tracker.html`.

`tracker.html` is both the page source and the generated artifact. The build
replaces its embedded data and CSS blocks and updates asset hashes.

## Run the pipeline

The main stages are resumable and keep their intermediate state locally.

```bash
npm run seed
npm run pointers
npm run match
npm run dates
npm run compliance
npm run gaps
npm run audit
npm run report
```

Run `node scripts/hpt/run.js` without arguments to list every stage and option.
The full pipeline reference is in
[`scripts/hpt/README.md`](scripts/hpt/README.md).

### Build the pointer corpus

```bash
npm run hpt:pointers:corpus
npm run hpt:pointers:headers
npm run hpt:combine-corpus
```

The corpus keeps every pointer entry and MRF URL. Its combined export is a full
outer join, so unmatched corpus entries and database-only hospitals remain
visible for review.

### Review direct MRF leads

```bash
npm run hpt:direct-mrf:prepare -- --input=path/to/links.csv
npm run hpt:direct-mrf:headers
```

Input CCNs and URLs are claims, not accepted matches. A row can be imported only
when the MRF header independently supports the same facility.

## Update the published snapshot

Pipeline output does not automatically replace the public snapshot.

1. Review the generated `manifest.csv`, `compliance.csv`, and `gaps.csv`.
2. Copy the approved files into `data/hpt-audit/`.
3. Refresh and verify the derived files.

```bash
npm run export:pointers
npm run obfuscate:pointers
npm run check:pointers-private
npm run build
npm test
node scripts/check-contrast.js
```

GitHub Actions repeats the privacy, pointer-contract, contrast, build, and
payload checks before deploying the static site.

## Pointer contact obfuscation

Hospital pointer files can include `contact-name` and `contact-email` fields.
Those values are stored as AES-256-GCM ciphertext in
`data/hpt-audit/pointers/`.

```bash
npm run obfuscate:pointers
npm run check:pointers-private
```

The key at `data/hpt-audit/.pointer-obfuscation-key` is intentionally committed.
This prevents plain-text indexing; it is not secret storage. Anyone with the
repository can decode the values.

The local servers decrypt protected pointer responses in memory and do not write
the plaintext back to disk. They also refuse HTTP access to the key and private
outreach files.

To restore the pointer files deliberately:

```bash
node scripts/hpt/obfuscate-pointers.js --restore
```

## Outreach records

The tracker can keep research notes, email history, follow-up dates, and manual
corrections.

```bash
npm run serve:outreach
```

This starts the tracker at `http://localhost:8080/tracker.html` with a local
write API. Records are stored in the ignored file `cms_data/outreach.json`.
`cms_data/outreach.public.json` is the redacted copy used by the static site.

The same records can be managed from the command line:

```bash
node scripts/outreach-cli.js help
node scripts/outreach-cli.js find "hospital name" --state NY
node scripts/outreach-cli.js apply plan.json
node scripts/outreach-cli.js apply plan.json --commit
```

The apply command is a dry run unless `--commit` is supplied.

## Repository layout

```text
data/hpt-audit/                 reviewed public data snapshot
cms_data/                       CMS roster, normalized roster, domains, coordinates
scripts/hpt/                    discovery, matching, import, and audit pipeline
scripts/build-tracker.js        embeds snapshot data and CSS in tracker.html
scripts/export-pointers.js      builds the reduced pointers.json contract
tracker.html                    tracker application and embedded data
mrf.html                        MRF explainer
rules.html                      CMS rules explainer
pointer.html                    cms-hpt.txt explainer
skill.html                      outreach workflow documentation
css/                            site styles
js/                             tracker and outreach behavior
```

## Configuration

Optional search, model, and unblocker credentials belong in `.env.local`, which
is ignored by Git. The runner loads `.env` first and applies `.env.local` as an
override. Do not commit either file.

Website discovery has a free-first, stage-only trial that uses the retained pointer
archive, Wikidata, OpenStreetMap, stale-domain redirects, and domain guesses.
Run `npm run find:domains:trial`. It writes review files under the ignored
`data/hpt-audit/.domain-discovery/` directory and does not change the published
tracker unless a reviewed `verified.csv` is promoted explicitly.

When no search provider is available, the same command can reverse-match
unrepresented pointer-declared MRF headers, retry blocked shared domains, and
use archived pointer pages as leads for stale domains. Archived content is
never treated as current proof. Every result must still pass the live pointer
and MRF evidence checks before it can be added.

Ambiguous public-source names can optionally be reviewed through OpenRouter
with `--llm-review --model=z-ai/glm-5.3-flash`. These model results only affect
review priority. They do not establish a verified domain.

For a reviewed candidate set, `--llm-name-match` can ask the same model whether
a low-scoring pointer location is a rename or alias of the CMS facility. Only a
high-confidence match satisfies the name gate. Pointer, MRF header, license
state, location, and uniqueness checks still apply before promotion.

For the remaining unresolved hospitals, `npm run find:domains:relationships`
adds NPPES organization aliases, resolved sibling facilities, protected pointer
contact domains, nonprofit Form 990 websites, CMS enrollment relationships when
the source files are reachable. `npm run find:domains:glm` is a separate,
resumable GLM candidate pass through OpenRouter. Model output is never accepted
as proof. Every suggested domain goes through the same live pointer and MRF
checks.

When Serper is configured, `npm run find:domains:serper` spends at most 579
search credits on a deterministic, stratified set of missing-domain hospitals.
It performs one search per hospital, caches every returned domain, and verifies
only the first domain initially. Later passes can test the cached lower-ranked
domains without spending another search credit.

The default trial uses public or open-data sources without a paid API account.
Serper and OpenRouter are separate, account-backed services. Their responses
remain in the ignored staging directory; only independently verified hospital
facts are eligible for the public tracker.

See the [pipeline reference](scripts/hpt/README.md) for supported variables.

## License

Code is licensed under the
[GNU Affero General Public License v3.0](LICENSE). The CMS roster is a US
government work. Hospital pointer and price files remain the work of their
publishers.

Website candidate discovery may incorporate data from
[OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available
under the Open Data Commons Open Database License (ODbL). Wikidata structured
data is available under CC0.

Built by [anthonyisnotadev](https://github.com/anthonyisnotadev).
