# Recovery of 856 unresolved hospital records

Checked 856 frozen records. 135 corrections were applied locally. 52 additional records have corroborated facility identity and an old declared update date or template. 669 retain unresolved blockers.

The earlier 34 corrections, three quarantines, and 97 publisher-review cases were preserved. Raw audit CSVs were not changed. No outreach, purchase, commit, push, or deployment was performed.

The initial free pass recovered 73 correction candidates; 62 additional corrections followed the browser/model/search stages. Native/curl retrieval checked 1584 distinct candidate URLs. 8 browser observations were recorded; browser coverage is selective, with remaining jobs retained in private staging.

The GLM-5.3-Flash pilot completed 60 cases using 113 model calls. OpenRouter reported $0.08739999 in actual usage. Reserved or uncertain cost: $0.00000000. Serper calls: 0. The combined ceiling remains $10; unused budget does not authorize expansion beyond this pilot.

## Evidence and remaining work

- [Per-hospital assessments](assessments.csv): separate site, pointer, identity, file, metadata and browser observations.
- [Verified corrections](verified-corrections.json): current pointer linkage, facility metadata and response hashes.
- [Remaining queue](followup-queue.csv): every uncorrected record and its next action.
- [Candidate file evidence](file-evidence.csv): successful and unsuccessful candidates, including identity rejection reasons.
- [Request attempts](attempts.json): hospital IDs, requested/final URLs, method, time, response/error, bytes and hashes.
- [Spending](pilot-spending.json) and [summary](summary.json): actual costs and recovery yield by host and transport.

## Interpretation

These are evidence-based header and pointer corrections, not full price-row validation or legal compliance certification. A browser-readable pricing page does not prove automated access to its file. A file found outside the pointer cannot resolve a pointer issue. Larger files, unsupported formats, missing metadata, conflicting locations/licenses, and competing current files remain unresolved.

Raw file reads and hash-matching pointer bodies supporting corrections are retained in ignored staging. Earlier page checks retain sanitized excerpts and hashes. Model output provides leads only; independent verification controls application. Search requests were handled through available web tools with Serper disabled. See [the recovery workflow](../../../../../scripts/hpt/RECOVERY.md) for resumption commands.

## Current disposition

- file-access-review: 91
- correction-verified: 135
- publisher-date-review: 42
- publisher-template-review: 10
- metadata-or-pointer-review: 29
- identity-or-format-review: 220
- pointer-or-domain-review: 329

## Validation

All 127 regression tests passed. Intervention generation and the tracker build passed. The rebuilt tracker was checked in the browser: Banner Gateway displays the reviewed correction alongside the original audit, and Northside retains its unresolved file assessment with a separate browser observation. Git diff whitespace checks passed. A scan of 28 report and generated artifacts found no configured secrets or non-placeholder email addresses after redacting email-shaped redirect values; original responses remain in ignored staging.
