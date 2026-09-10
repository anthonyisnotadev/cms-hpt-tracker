# Resolution review — September 9, 2026

All 990 originally flagged hospital records were reassessed using 657 domain groups and 836 freshly requested file URLs. This is a capped discovery and file-header review, not full-file validation or a regulatory compliance determination.

| Outcome | Hospitals |
| --- | ---: |
| Verified correction applied to current tracker view | 34 |
| Previous file assignment quarantined | 3 |
| Corroborated file with old declared date | 66 |
| Corroborated file with older declared template | 31 |
| Identity or format needs review | 281 |
| Pointer or domain needs review | 394 |
| Metadata or pointer needs review | 62 |
| File access needs browser review | 119 |
| Total | 990 |

The earlier pass produced 56 candidates. This pass refreshed responses and tightened identity and metadata extraction; the 34 confirmed corrections are a different, more restrictive result, not automatic acceptance of all earlier candidates.

## What changed

The matcher now requires facility-specific name evidence and a matching street plus city or ZIP; common system branding and ZIP numbers cannot substitute for a street match. JSON metadata is read from root fields, CSV metadata can follow a preamble, invalid calendar dates are rejected, and HTML response content overrides misleading MIME types. Price-row dates and generic JSON state fields cannot become hospital metadata.

The current tracker consumes a reviewed resolution ledger. Original compliance, manifest and gaps CSVs remain unchanged. A correction only applies while its original audit record still matches; a subsequent crawl supersedes that ledger entry. Each changed hospital retains its original audit event in the drawer. All 990 have separate website, pointer, identity, access and metadata observations.

## Identity adjudication

* **010023 — Baptist Medical Center South, Alabama:** the old file identifies a Jacksonville, Florida facility. Quarantined. Official replacement lead: [Baptist Health pricing](https://www.baptistfirst.org/patients-visitors/before-your-visit/get-a-price-estimate); a replacement pointer/file assignment is still unresolved.
* **051300 — Eastern Plumas, Portola:** the old file identifies Tippah County Hospital, Mississippi. Quarantined. Official replacement lead: [Eastern Plumas pricing](https://www.ephc.org/price-transparency.php); a replacement pointer/file assignment is still unresolved.
* **100167 — HCA Florida Mercy:** roster naming and the Plantation/Westside file evidence conflict. Quarantined pending roster/address adjudication; shared HCA Florida wording is insufficient.
* **110124 — Wayne Memorial, Georgia:** replaced the Honesdale, Pennsylvania file with a freshly verified pointer/file for Jesup, Georgia, reached through [the official hospital](https://wmhweb.com/sb-505/).
* **140166 — St. Mary’s, Decatur:** replaced the Athens, Georgia assignment with a freshly verified Decatur pointer/file through [HSHS pricing](https://www.hshs.org/patients/billing/price).
* **160112 — Spencer Municipal:** the old file's license state conflicted with its Iowa address. A current replacement file corroborates Iowa and has been applied.
* **181309 — Casey County, 261332 — Carroll County Memorial, 271314 — Deer Lodge:** old file addresses identify the expected location but license states conflict. These remain metadata/identity review cases; the state gate was not waived and they were not automatically treated as wrong websites.

## Review material

* `assessments.csv`: all 990 hospital-level outcomes.
* `file-evidence.csv`: individual pointer/file/header observations, timestamps and pointer body hashes.
* `resolutions.json`: generated proposals; the applied reviewed ledger is `data/hpt-audit/reviewed-resolutions.json`.
* `followup-queue.csv`: 956 remaining records, explicit next actions and evidence keys.
* `publisher-review.csv` and `outreach-drafts.json`: 97 reviewable publisher inquiries. No recipients have been selected and no messages were sent.

CMS's [CSV data dictionary](https://github.com/CMSgov/hospital-price-transparency/blob/master/documentation/CSV/README.md) and [JSON data dictionary](https://github.com/CMSgov/hospital-price-transparency/blob/master/documentation/JSON/README.md) describe v3.0 for 2026. A version declaration alone does not validate the complete schema or charge rows. Date freshness here means the declared date was within 365 days at the observation time.

Network discovery followed a bounded set of explicit links. Compressed or unusually structured files can require deeper inspection. HTTP success alone is recorded as a response, not proof of a usable MRF. Browser/tool access failures do not establish hospital blocking. Remaining rows require browser retrieval, deeper parsing, facility adjudication, or a publisher response; they have not been marked resolved.

## Local validation

All 107 automated tests passed, the tracker build passed, and JavaScript syntax and diff whitespace checks passed. The browser preview rendered the new labels and the quarantined Baptist South record's separate observations, original audit event and reviewed recheck. Embedded data contains 990 assessments and 37 preserved original events. The original compliance, manifest and gaps CSVs have no changes. A pattern scan of 16 review/ledger artifacts found zero email addresses and zero matches for the tested credential prefixes. Changes remain local; no outreach was sent and nothing was pushed or deployed.
