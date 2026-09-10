# Public contact protection

Run `npm run protect:contacts` after generating public data and
`npm run check:contacts-private` before committing. `npm run build` performs
both steps, and the Pages workflow rejects unprotected input before building.
The scan includes Git-visible JSON, CSV, text evidence and top-level HTML under
the public data paths. Ignored source files and retrieval caches remain local.

Contact names in labeled fields, email addresses (including masked addresses),
phone fields, formatted US phone numbers and compact `tel:` links use the
existing `hpt-obf:v1` AES-256-GCM encryptor. Hospital names, physical facility
addresses, CCNs and NPIs remain identity evidence. Manually review prose for
unlabeled person names and unusual contact formats; pattern checks cannot
recognize every form of personal information.

The key is intentionally shared by this repository. This obscures contacts in
the stored files; it is not confidential storage or a guarantee against search
indexing. Existing public Git history and search caches are unaffected.
The public UI displays protected contacts as `[protected contact]`. Local
pointer and transcript routes decode in memory, and the local outreach server
continues to use its ignored private source. Sender defaults are placeholders;
configure `HPT_OUTREACH_NAME` and `HPT_OUTREACH_EMAIL` locally for drafts.

`npm run redact` retains name masking and encrypts the generated public copy,
reusing ciphertext when the redacted source has not changed. Never commit the
private outreach input, name replacement list, publisher replies, or `.env` files.
Source-response hashes describe original retrieved bytes; encryption changes
the stored representation without changing the decoded evidence.
