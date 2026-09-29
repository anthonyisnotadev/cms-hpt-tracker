# Nationwide hospital verification review

> **Historical snapshot: 2026-09-15.** The counts below are not the current tracker totals and must not be used as a live status report. See the [current nationwide snapshot](nationwide-verification.json), [exact-CCN snapshot bridge](nationwide-snapshot-bridge.json), and [current accuracy plan](accuracy-plan.md).

Generated from the reconciled local evidence snapshot on 2026-09-15. This report records observed discovery and retrieval outcomes; it does not make legal compliance findings.

## Coverage

- 5,419 hospital CCNs reviewed; 5,419 unique CCNs represented.
- Every CCN has an explicit disposition and next action.
- Fresh website-search work is complete for all 97 hospitals that still need a supported official-site determination (`search_pending: 0`).
- All 148 pointer-linked MRFs selected for browser/download-capable retry have a recorded browser outcome (`mrf_browser_pending: 0`).
- The refreshed pointer corpus contains 2,647 retrieved pointer documents and 4,863 unique pointer-declared MRF URLs.
- The 569-hospital frozen cohort is fully represented: 37 now have a current facility-corroborated MRF, 3 have a facility-corroborated stale MRF, and the other 529 have an evidence-stage-specific unresolved disposition rather than the former provisional labels.

## Current dispositions

The primary effective accounting is precedence-aware and mutually exclusive:

| Effective category | Hospitals |
|---|---:|
| Active verification claim | 2,786 |
| Standing evidence retained despite a newer incomplete observation | 1,318 |
| Genuinely unresolved latest assessment | 1,100 |
| Superseded by a later reviewed resolution | 51 |
| Scope-exempt observation not superseded by a later resolution | 164 |

These effective categories total exactly 5,419. The table below is the raw latest-observation taxonomy; it is diagnostic and must not be added or interpreted as the current standing-status total.

The reconciliation inventory separately assigns each CCN to one exclusive workstream: 2,945 are consistent, 1,099 need genuinely unresolved investigation, 1,316 are lower-risk follow-ups against retained standing evidence, 42 need retained verification-byte proof, and 17 are supported uncertainties to monitor rather than generic retries. The actionable queue therefore contains 2,457 rows, partitioned into 1,099 investigations, 1,316 standing-evidence follow-ups, and 42 proof gaps.

| Internal disposition | Hospitals | Meaning |
|---|---:|---|
| `verified-current-mrf` | 2,654 | Facility-linked MRF identity is corroborated and the observed metadata is current CMS v3. |
| `verified-stale-mrf` | 87 | Facility-linked identity is corroborated, but the declared update date is over 365 days old. |
| `verified-template-review` | 48 | Facility-linked identity is corroborated, but the declared template is older or unresolved. |
| `scope-exempt-federal` | 164 | Federal facility retained outside this review's rule scope. |
| `scope-exempt-closed` | 2 | Dated official evidence supports a closed-facility scope disposition. |
| `linked-mrf-header-unmatched` | 715 | The linked file responded, but its bounded header did not safely establish this facility. |
| `pointer-discovery-incomplete` | 510 | Pointer discovery could not complete because of a request, DNS, navigation, or client-layer failure. |
| `mrf-facility-identity-unresolved` | 341 | A returned MRF candidate exists, but facility identity remains unresolved. |
| `pointer-access-denied-to-client` | 296 | The checked pointer request was denied, rate-limited, or challenged for this client. |
| `pointer-facility-match-unresolved` | 254 | A structured pointer was retrieved, but no entry was safely linked to the CCN. |
| `official-website-not-identified-completed-search` | 97 | A completed fresh search did not support an official facility website. |
| `mrf-request-unsuccessful` | 148 | A facility-linked file URL was identified, but the browser/direct retrieval attempt did not return a usable file. |
| `pointer-not-retrieved` | 98 | Checked official pointer locations returned no usable pointer. |
| `mrf-verification-pending` | 5 | A file was retrieved, but its identity or metadata still needs reconciliation. |

The raw dispositions total 5,419. After precedence is applied, 1,100 CCNs have a genuinely unresolved latest assessment. Another 1,318 have a newer incomplete or unresolved operational observation while retaining stronger dated standing evidence; these are visible in history and queues but are not counted as though the earlier evidence disappeared. Fifty-one older observations are superseded by later reviewed resolutions. This corrects the former 2,548 figure, which mixed unresolved hospitals with incomplete retries against already-supported findings.

## Historical frozen 569-hospital cohort snapshot

| Disposition | Hospitals |
|---|---:|
| Current facility-corroborated MRF | 37 |
| Stale facility-corroborated MRF | 3 |
| Official website not identified after completed search | 122 |
| Pointer access denied to this client | 117 |
| Pointer discovery incomplete due to request/tool failure | 191 |
| Pointer retrieved; facility match unresolved | 22 |
| Linked MRF returned; header identity unresolved | 52 |
| MRF facility identity unresolved | 18 |
| MRF request unsuccessful | 3 |
| Pointer not retrieved from checked locations | 4 |

These rows total 569. None remains under the original generic “no candidate” or “candidate found” label.

## Evidence handling

- Website search results were treated as leads until a first-party page corroborated facility name and address.
- Pointer, file access, facility identity, and declared metadata were recorded separately so that one successful stage cannot hide a failure at another stage.
- Browser and direct-request failures remain transport observations. HTTP 403, 404, DNS errors, timeouts, and client blocks were not converted into claims that a hospital or file does not exist.
- Bounded reads were used for large CSV/JSON files and archives; full nationwide MRF downloads were not performed.
- Shared-system files were accepted only when the target facility or its roster-matching location/address was explicitly present.
- Original crawl and review artifacts remain available alongside the presentation overlays.

## Remaining evidence work

There are 755 deduplicated pointer-browser targets, of which 596 remain pending. They do not equate to 596 unresolved hospitals: targets can cover multiple CCNs, and many are incomplete retries attached to stronger retained evidence. A retry may improve evidence, but an unchanged external failure remains an operational observation rather than a downgrade.

No commit, push, publication, or outreach was performed.
