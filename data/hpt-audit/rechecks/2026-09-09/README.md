# Recheck of the 990 intervention records

Run date: September 9, 2026 UTC (September 8 in US Eastern time). Original tracker snapshot: September 7, 2026.

All 990 hospitals in the requested 15 groups received a fresh automated recheck. The run checked 645 distinct recorded pointer URLs, tried the alternate www hostname where a root pointer was unreadable, checked 241 homepages separately, and probed 1,589 distinct MRF URLs. Shared system pointers account for the larger number of files.

## Results

| Result | Hospitals |
| --- | ---: |
| Pointer-linked file with corroborated hospital identity and a readable date | 202 |
| At least one candidate file responds, but identity or metadata needs review | 307 |
| Pointer entries readable, but file checks remain unresolved | 104 |
| Access or discovery remains unresolved | 377 |
| **Total** | **990** |

Of the 202 records with corroborated identities and dates:

- **56** have a selected pointer-linked file with an update date within 365 days and template version 3. These are correction candidates for the previous finding.
- **99** still have an extracted update date over 365 days old.
- **44** have a recent date but an older declared template version.
- **3** have a recent date but no verified template version.

The 56 correction candidates comprise 10 from the old format group, 11 from the stale group, 3 from the old-template group, 2 from the edge-access group, 3 from the missing-MRF group, and 27 from the server-access group. An observation that changed since September 7 does not by itself establish that the September 7 observation was wrong.

## Evidence that the old wording overstated the findings

- **15 previously undated MRF URLs now yield readable dates.** This establishes date readability for those URLs; facility identity still needs a separate check. Ten records from the original format group have a corroborated pointer/file identity and current version-3 metadata in this recheck.
- **125 of 241 checked homepages returned HTTP 2xx** while pointer retrieval remained unresolved. A successful homepage response is separate from a readable pointer, and does not alone verify the site's identity or content.
- **Eight previously assigned files have extracted state information conflicting with the CMS roster.** Some name a different hospital; others may have incorrect license-state metadata. They need identity adjudication, rather than a blanket format or freshness diagnosis.
- Example: **010023, Baptist Medical Center South, Alabama**, was assigned a file that identifies **Southern Baptist Hospital of Florida, Inc.** and declares state **FL**. Recovering a date from that file cannot validate the Alabama assignment.
- The original **166 “Unusable file format”** records actually contain **160 date-extraction failures** and **6 entries with no extracted MRF URL**. The local tracker now labels these separately and describes both as unverified observations.

## Review files

- [All 990 hospital results](intervention-recheck.csv): original finding, pointer attempts, homepage response, selected file/date/version, and reconciliation status.
- [Per-file evidence](intervention-mrf-evidence.csv): candidate URL, pointer provenance, response status, parsed hospital/address/state, full-roster match result, and check timestamp. Candidate files may belong to other hospitals.
- [56 correction candidates](correction-candidates.csv): corroborated pointer/file identities with recent dates and version 3.
- [Eight state conflicts in previously assigned files](identity-conflicts.csv): compare the CMS location with the parsed file location before changing an assignment.
- [15 previously undated URLs with readable dates](dates-now-readable.csv).
- [Machine-readable summary](intervention-summary.json).

## Method and remaining work

Requests used the existing browser-like HTTP headers. Pointer responses were capped at 256 KiB. File probes used bounded headers and compressed-header handling, with a wider read capped at 1 MiB when the date could not be recovered. No complete pricing-file schema or charge validation was performed. A partial read cannot prove that a metadata field is absent from the entire file.

Identity corroboration used the full CMS roster and the existing name, address, and license-state matcher. Unresolved names were compared against candidate files from their shared pointers. All 144 original name-review cases remain open under this conservative matcher; they need alias, rename, or facility-level adjudication. A correct hospital name can coexist with incorrect state metadata in a vendor file.

Access outcomes describe this client at check time. A browser attempt on a sampled 406 case was itself blocked by the browser tool, so it did not provide independent hospital-side evidence. Browser adjudication and official-domain discovery remain necessary for unresolved access cases. Local sandbox-denied requests from the first attempted pass were excluded; the completed run used network-enabled requests after a control check.

The published-snapshot compliance and manifest files were retained. The local tracker wording and generated intervention overlay were revised. The recheck evidence is a separate dated artifact; it has not been automatically promoted into the historical snapshot. Review correction candidates and conflicts before importing new assignments.

Reproduce the frozen cohort from its ignored cache with `node scripts/hpt/recheck-interventions.js --report-only`. Run `node scripts/hpt/recheck-interventions.js` to resume missing URL checks, and `--homepages-only` for the separate homepage pass. The cache records parsed evidence, URLs, timestamps, errors, and pointer-body hashes; it is not a full raw-response archive.
