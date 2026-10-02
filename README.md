# CMS Hospital Price Transparency Tracker

A hospital-by-hospital check of whether US hospitals have published the price
files that federal rules require, and whether those files can be found and
opened.

**[Open the live tracker](https://mrf.anthonyisnota.dev)**

## Current status

Local research snapshot from 2026-10-02 00:41 UTC. The live site may show an
older published version.

| Review category | Hospitals |
| --- | ---: |
| Active verification claim | 3,369 |
| Standing evidence retained | 847 |
| Superseded by reviewed resolution | 490 |
| Scope exception | 200 |
| Unresolved investigation | 512 |
| Supported identity uncertainty | 1 |
| **Total (full CMS roster)** | **5,419** |

Each hospital is in exactly one category. The categories describe the state of
the research, not compliance scores. See [Research progress](#research-progress)
for what each one means.

## What this project does

Federal rules require most US hospitals to publish their prices in a
machine-readable file (an MRF). The files are public, but they are spread across
thousands of hospital websites and are hard to locate.

The tracker goes through the entire CMS hospital list, one hospital at a time,
and records:

- where the hospital's price file lives
- whether the file opens
- when it was last updated
- whether the file identifies the same hospital

The results are available as a searchable website and as CSV files.

### What it does not do

- It does not judge whether a price is fair.
- It does not check every price inside every file.
- It does not determine that a hospital broke the law.

An "unresolved" hospital means the research has not confirmed a file yet. It is
not a finding of wrongdoing. Websites move, block automated visitors, or go
down.

## Glossary

| Term | Meaning |
| --- | --- |
| **CMS** | Centers for Medicare & Medicaid Services, the federal agency that maintains the official hospital list and sets the rules |
| **MRF** | Machine-readable file: the large file in which a hospital lists its prices |
| **`cms-hpt.txt`** | A small text file on a hospital's website that points to the hospital's MRF |
| **CCN** | CMS Certification Number, the identifier for each hospital |
| **Manifest** | The table pairing each hospital with its file, plus the supporting evidence |
| **Gap** | A hospital whose file has not been accounted for |

## How a hospital is matched to a file

A file turning up is not enough. Many hospitals share a name, health systems
share websites, and buildings change names after acquisitions. Each match has to
be supported by evidence:

1. Start from the official CMS hospital list.
2. Find the hospital's website.
3. Find the site's `cms-hpt.txt` pointer file.
4. Follow the pointer to the price file.
5. Read the start of the price file and compare address, ZIP, state, and license
   number with the CMS record.

If these agree, the match is confirmed. If anything is ambiguous, the hospital
stays in review. A name alone is never treated as proof. The files are very
large, so only the first part of each is read.

## Research progress

The snapshot above was rebuilt on 2026-10-02, 00:41 UTC. Finding and opening a file does not check every price or
establish legal compliance.

### Where all 5,419 hospitals stand

| Review category | Hospitals | What remains |
| --- | ---: | --- |
| Active verification claim | 3,369 | Keep dated file and identity evidence; stale dates or template concerns may still require follow-up |
| Standing evidence retained | 847 | Reconcile the newer observation without discarding stronger earlier evidence |
| Superseded by reviewed resolution | 490 | Preserve the earlier observation as history and use the reviewed resolution |
| Scope exception | 200 | Retain the documented reason for excluding the record from ordinary verification |
| Unresolved | 512 | Resolve discovery, access, pointer linkage, or facility identity using the per-CCN next action |
| Supported identity uncertainty | 1 | Resolve the documented facility identity question before assigning a result |

### What still needs work

1,708 hospitals have a recorded investigation, follow-up, or monitoring step.
Each hospital appears once below. These workstreams overlap the categories
above, so the two tables should not be added together. Only 512 hospitals are
unresolved.

| Next-step workstream | Hospitals |
| --- | ---: |
| Newer evidence to weigh | 639 |
| Still unresolved | 511 |
| Recheck could not finish | 394 |
| Other follow-up | 85 |
| Watching for a change | 62 |
| Facility identity review | 10 |
| Same-campus scope review | 5 |
| Conflicting observations | 2 |

Completed scope exceptions do not automatically become "close as exempt"
tasks. A documented scope or identity follow-up can still remain for a record
with an existing result. These counts are generated for the website by
[`buildReviewedWorkQueue`](scripts/hpt/lib/tracker-work-queue.js) from its
source-validated reviewed worklists, using effective dispositions to exclude
investigations already resolved by overlays.

### Checklist

- [x] Represent every hospital in the 5,419-record CMS list
- [x] Give every hospital a review category
- [ ] Resolve the remaining 512 unresolved cases
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

## The rules

CMS Data Dictionary **3.0.0** is the current required MRF template. Its CY 2026
requirements took effect January 1, 2026, with CMS enforcement beginning April
1, 2026.

For each hospital the tracker asks:

1. Was the hospital's website found?
2. Does the site have a `cms-hpt.txt` pointer file?
3. Does the pointer lead to a price file?
4. Does the file open, and does it name the right hospital?
5. Was it updated within the last year?

<details>
<summary>Template version details</summary>

An identity-matched file that clearly declares a 1.x or 2.x template does not
meet the current version requirement. A file declaring `3`, `3.0` or `3.00` is
read as the v3 template: these are formatting variants of 3.0.0, and the CMS
validator raises only an alert, not an error, for `3.0`. The alert stays in the
record's evidence, but the file is not flagged for its version. Other
non-3.0.0 literals (for example `3.0.1`, `4.0.0` or a date string) need source
review; an unread or missing version is unknown, and a 3.0.0 declaration alone
does not establish full-file compliance.

</details>

## Limitations

- Some hospital websites block automated visitors.
- The official hospital list can lag behind closures, buyouts and name changes.
- One health-system file may not name every campus it covers.
- A file that opens can still contain incomplete or wrong prices.
- When a building's identity is unclear, a person has to decide.

## Site pages

| Page | Contents |
| --- | --- |
| [Tracker](tracker.html) | The searchable table of hospitals |
| [Hospital price files](mrf.html) | What an MRF is |
| [CMS rules](rules.html) | The rules hospitals must follow |
| [Pointer files](pointer.html) | What `cms-hpt.txt` is |
| [Outreach skill](skill.html) | How emails and fieldwork are logged |

---

# For developers

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
