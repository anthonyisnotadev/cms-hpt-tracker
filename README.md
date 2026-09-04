# CMS Hospital Price Transparency Tracker

[View the live tracker](https://mrf.anthonyisnota.dev)

## What this project does

Most US hospitals are required to publish their prices in a machine-readable
file. These files include list prices, cash prices, and rates negotiated with
insurance plans. They are public, but they are spread across thousands of
hospital and health-system websites and are not always easy to locate.

This project works through the national CMS hospital roster and records where
each hospital's file is published, whether it opens, and when it was last
updated. The results are available as a searchable website and as CSV files for
further analysis.

The tracker answers a fairly narrow set of questions:

- Was a hospital website identified?
- Does the site publish the required pointer file?
- Does that pointer lead to a machine-readable price file?
- Can the file be opened, and does its header identify the expected hospital?
- Is the reported update date within the required annual cycle?

It does not check every price inside an MRF or decide whether an individual rate
is accurate.

## Terms used in this README

| Term | Meaning |
| --- | --- |
| CMS | The Centers for Medicare & Medicaid Services, the federal agency that maintains the hospital roster and administers the rule |
| MRF | Machine-readable file, usually CSV or JSON, containing a hospital's published standard charges |
| `cms-hpt.txt` | A small pointer file at a hospital website's root that lists the hospital name, price-page URL, direct MRF URL, and contact information |
| CCN | CMS Certification Number, the facility identifier used to connect records across the dataset |
| Manifest | The table of confirmed hospital-to-MRF matches and the evidence behind them |
| Gap | A record that still needs research or could not be assessed with the available evidence |

## Current snapshot

The current snapshot was generated on September 3, 2026.

| Measure | Count |
| --- | ---: |
| Hospitals in the CMS roster | 5,419 |
| Hospitals with a recorded MRF | 3,870 |
| Rows in the gap worklist | 1,562 |

| Status | Count | Meaning in this tracker |
| --- | ---: | --- |
| Compliant | 3,403 | The file opened and passed the checks represented in this dataset |
| Not compliant | 463 | A required file was missing, broken, stale, or used an outdated format |
| Blocked | 175 | The website prevented an automated result |
| Not assessed | 1,214 | There was not enough evidence to make a finding |
| Exempt | 164 | The hospital is outside this rule, primarily because it is federally owned |

The distinction between a finding and a research gap is intentional. A missing
or unconfirmed website is not treated as proof that a hospital failed to
publish.

## How hospitals are matched to files

Finding a price-file URL is not enough. Hospital names repeat, health systems
share websites, and facilities change names after acquisitions. The CMS roster
also provides names and addresses but no website domains.

A domain or external link therefore starts as a lead. The usual evidence path
is:

```text
CMS roster record
  -> hospital domain
  -> hospital-hosted cms-hpt.txt
  -> pointer-declared MRF URL
  -> facility identity in the MRF header
```

The MRF header identifies the facility before the full price table begins. A
match can use the state, street address, ZIP code, license information, and other
identifiers in that header. A name by itself is not enough. When the evidence is
ambiguous, the record stays in review.

Only `matched_ccns` are used as exact facility links during corpus imports.
`related_ccns` provide context for shared system pointers but do not establish a
match.

MRFs are often very large. Discovery normally requests only the file metadata
and a limited section of the header with HEAD and Range requests instead of
downloading the complete file.

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

## Limitations

- Some hospital websites block automated requests.
- CMS roster records can lag behind closures, acquisitions, and name changes.
- A health-system file may not clearly identify every campus it covers.
- A reachable file can still contain incomplete or inaccurate prices.
- Manual review remains necessary when facility identity is ambiguous.

## Site pages

- [Tracker](tracker.html)
- [Hospital price files](mrf.html)
- [CMS rules](rules.html)
- [Pointer files](pointer.html)
- [Outreach tool](skill.html)

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
