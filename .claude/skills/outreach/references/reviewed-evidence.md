# Reviewed evidence and current next actions

Use this reference when a request concerns MRF discovery, hospital identity,
corrections, or the research work queue. Run commands from the repository root.

## Read before changing a finding

1. Resolve the hospital against `cms_data/hpt/roster.json`, preserving the CCN.
2. Read its existing outreach record with `node scripts/outreach-cli.js show <ccn> --json`.
3. Load the effective research view with `loadReviewedView()` from
   `scripts/hpt/lib/reviewed-resolutions.js`. Read that CCN's nationwide record,
   compliance finding, and reviewed evidence rather than relying on a base CSV.
4. Consult the relevant records in `data/hpt-audit/`:
   - `unresolved-investigation-worklist.json`: unresolved investigations and evidence gates.
   - `standing-evidence-followup-worklist.json`: newer observations needing reconciliation.
   - `supported-uncertainty-followup-worklist.json`: supported uncertainty and monitoring triggers.
   - `identity-quarantine-worklist.json`: rejected or uncertain facility assignments.
   - `same-campus-ccn-transition-worklist.json`: shared-campus and enrollment scope review.
   - `nationwide-reconciliation.json` and `nationwide-reconciliation-queue.json`: other discrepancies and next actions.

Worklists contain source hashes. A stale or missing worklist is not evidence that
a hospital failed a check. The tracker builder validates its inputs and
`buildReviewedWorkQueue()` excludes base investigations already resolved by
effective overlays. Monitoring and retained-evidence follow-ups are not all
unresolved hospitals. Derive counts from current records; never hardcode a
previous snapshot's unresolved count. Nationwide totals must cover 5,419 unique CCNs.

## Evidence required for corrections

- Keep website identity, pointer access, pointer-to-file linkage, file access,
  facility identity, and declared metadata as separate observations.
- Prefer the official `cms-hpt.txt` pointer and its declared MRF. A reviewed
  official price-page file can be useful evidence when the pointer route fails;
  preserve which route supplied it and the pointer limitation.
- Verify the file's facility name, address, state, and campus coverage for each
  CCN. Shared system branding, a shared domain, or a readable file alone does not
  prove that the file covers a hospital. Keep conflicting identity evidence visible.
- Record observation time, source URL, declared update date and template version,
  retrieval result, and exact remaining next action when available. File dates
  come from file metadata, not download time or website deployment time.
- A 403, timeout, challenge, or client block is an access observation, not proof
  of a missing file. A hospital's promise to fix a file is a reply, not a verified fix.
- The store still accepts `compliant` and `failing` enum values for compatibility.
  Explain them as limited tracker findings, not legal determinations or validation
  of every price. Verify official guidance before making regulatory claims.
- Scope exceptions require facility-specific documented support. Do not clear an
  investigation simply because an old gap row says to close it as exempt.

Record supported fieldwork through an outreach plan and dry run. If the request
also authorizes research changes, use the existing reviewed-resolution or
observation workflow and preserve stronger evidence and history. An outreach
`correction` alone does not update the nationwide research artifacts.

## Refreshing an authorized research snapshot

`npm run hpt:verify:reconcile-all` runs the ordered rebuild in
`scripts/hpt/rebuild-reviewed-artifacts.js`, including evidence audit,
reconciliation, worklists, interventions, and tracker generation. It writes
multiple artifacts; use it for an authorized research refresh, not a routine
outreach note. Missing ignored proof bytes or hash mismatches must be resolved
from their actual sources, not bypassed or replaced with invented proof.

For a presentation-only rebuild, use `node scripts/build-tracker.js` with current
validated inputs. `npm run build` additionally runs contact protection and
glossary generation. Preserve unrelated work and review generated changes.

Report the research snapshot date separately from deployment and individual
observation dates. New data can remain local while the live site uses an older
snapshot. Update the dated README progress section from the effective reviewed
view when publishing a new snapshot; never refresh a date without refreshing
the data it describes.
