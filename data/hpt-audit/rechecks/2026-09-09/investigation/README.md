# Investigation of 821 unresolved hospital records

Reviewed September 9, 2026. The frozen cohort combines 721 remaining recovery records with 97 earlier publisher-review cases and three identity quarantines.

The investigation added 37 corrections, bringing the reviewed ledger to 212 entries: 209 replacements and three quarantines. Original compliance, manifest, and gap CSVs are preserved. These are pointer and header reviews, not full price-row validation or legal compliance determinations.

Interactive-browser retrieval (in-page fetches from each site's own origin, recorded as transport `browser`) resolved several bot-blocked systems: avera.org, phhealthcare.org, medcenterhealth.org, and leehealth.org. It also showed northside.com's asset host and the UNC elevatepfs export endpoint failing even for a real browser session, and one pricing page (Caverna) that will not load.

## Latest disposition

- 40 verified corrections.
- 219 publisher-review findings requiring review of the recorded observation before outreach.
- 565 unresolved records.

Publisher-review findings comprise 112 old declared dates, 36 older template versions, 20 unrecognized template versions (including avera.org's 4.0.0), 29 file requests returning 404, 12 denied automated requests, nine conflicting license states, and one unsupported file format. Failed requests do not establish that a hospital has no published file.

## Verification and follow-up

Corrections require pointer linkage, facility identity, current declared metadata, matching hashes of retained pointer and file bytes, and agreement with the original crawl. Identity adjudication handles documented DBA names, campus qualifiers, renames, and missing license fields conservatively. Competing current files remain unresolved.

Next steps for the 561 unresolved records:

- 7: Adjudicate competing current files against the pointer entries and roster address before assigning one
- 55: Browser download attempt on the recorded file URL; a failed automated request is not evidence the file is absent
- 213: Official-domain discovery
- 3: Facility identity adjudication against the roster before any pointer or file work
- 179: Compare the parsed header against facility aliases, renames and campus entries; extend the capped read only if metadata may sit beyond it
- 17: Browser pricing-page walk on the named domain to locate the pointer or its replacement
- 3: Publisher inquiry on the declared template version; recheck after their update window
- 10: Record the direct file URL behind the web page served at the recorded file URL (browser or manual download), then re-verify
- 58: Adjudicate facility identity
- 5: Complete-file read beyond the capped header to recover identity or metadata fields
- 14: Publisher inquiry on the recorded declared date; recheck after their update window

## Files

- [adjudication-worksheet.csv](adjudication-worksheet.csv): per-CCN decision sheet for the human adjudicator — roster row, file header, blocker, and the specific question with answer options.
- [results.csv](results.csv): disposition, evidence, and next step per CCN.
- [publisher-issues.csv](publisher-issues.csv): 223 observations for review.
- [correction-proposals.json](correction-proposals.json): 37 correction evidence chains.
- [browser-observations.json](browser-observations.json): recorded browser observation.
- [investigation-summary.json](investigation-summary.json): latest counts.
- [retrieval-jobs.json](retrieval-jobs.json): requested retrieval inventory.
- [original-evidence-hashes.json](original-evidence-hashes.json): preserved input hashes at the start of the run.

Raw retrieval results and targeted retrievals are ignored because they contain pointer contact fields and response headers. Raw bodies remain in ignored investigation staging. These private files are needed to reproduce analysis; the public reports preserve URLs, observations, and evidence hashes.

**Outreach:** on 2026-09-09 the user approved 222 of the 227 inquiry drafts (all except the 5 file-published-no-machine-pointer cases). The approved pack with per-hospital evidence is at [outreach-pack-approved.json](outreach-pack-approved.json) / [outreach-pack-approved.csv](outreach-pack-approved.csv), status approved-for-outreach, delivery via the user's own channel. The 5 held drafts remain in [publisher-drafts-awaiting-approval.json](publisher-drafts-awaiting-approval.json). Publisher responses, when they arrive, are intake-ready: record them in a JSON array of {ccn, kind: 'note'|'pointer'|'file', url?, text?} and run node scripts/hpt/stage-publisher-response.js <file> — pointer and file responses are fetched, hashed and staged for that CCN; then re-run scripts/hpt/analyze-investigation.js --apply to convert responding hospitals into verified corrections.

Reproduce with the retained private evidence using scripts/hpt/investigate-unresolved.js, scripts/hpt/verify-domain-leads.js, scripts/hpt/deep-read-capped.js, and scripts/hpt/analyze-investigation.js. Review proposals before applying them. No outreach was sent by this review.
