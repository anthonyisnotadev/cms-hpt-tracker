'use strict';

// Recheck the exact first-party Helen Keller CSV exposed by the current HH
// Health price-transparency page. Keep transport failure distinct from file
// content evidence; never substitute the sibling Huntsville or Red Bay MRF.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { retrieve } = require('./lib/recovery-transport');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const fileUrl = 'https://hh.health/wp-content/uploads/472323163_hellen-keller-hospital_standardcharges.csv';
const output = path.join(audit, 'reconciliation-helen-keller-current-file-recheck-2026-09-29.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const result = await retrieve(fileUrl, 262144, { timeoutMs: 30000 });
  const observedAt = new Date().toISOString();
  const bytes = Buffer.from(result.body || '');
  const proof = {
    audit_id: 'reconciliation-helen-keller-current-file-recheck-2026-09-29',
    ccn: '010019',
    facility: 'Helen Keller Hospital, Sheffield, Alabama',
    observed_at: observedAt,
    reason: 'The current first-party HH Health pricing page was discovered to expose the exact Helen Keller CSV at a new hh.health URL, distinct from the previously timed-out cloudaccess.host URL and the legacy Huntsville 404.',
    first_party_page: {
      url: 'https://hh.health/patients-visitors/price-transparency/',
      observation_source: 'linked from the first-party Helen Keller Hospital page',
      page_observed_date: '2026-09-29',
      linked_label: 'Standard Charge File',
      linked_url: fileUrl,
    },
    file_attempt: {
      url: fileUrl,
      http_status: result.status,
      final_url: result.finalUrl || fileUrl,
      content_type: result.headers?.['content-type'] || '',
      bounded_bytes_retained: bytes.length,
      sha256_of_returned_body: sha(bytes),
      transport_error: result.error || '',
      attempts: result.attempts || [],
    },
    interpretation: result.status >= 200 && result.status < 300
      ? 'A response was obtained; this record does not promote the file. Parse and validate the returned bytes and fetch the complete file before any disposition change.'
      : 'The newly observed first-party URL did not return file bytes in this environment. This is a dated transport observation, not evidence of file absence, facility mismatch, metadata failure, or compliance.',
    outcome: {
      new_file_bytes: bytes.length > 0,
      disposition_changed: false,
      current_disposition: 'pointer-discovery-incomplete',
      next_action: result.status >= 200 && result.status < 300
        ? 'Parse the exact first-party response, then retrieve complete bytes from this route or a materially different authorized route; verify file identity, Sheffield address, Alabama metadata, CMS date/version and usable rows before any disposition change.'
        : 'Retry only after DNS/route/access changes or through a materially different authorized content-bearing route; then retain exact bytes/hash and verify Helen Keller identity, Sheffield address, Alabama metadata, CMS date/version and usable rows. Do not substitute Huntsville, Red Bay, or third-party derived prices.',
    },
  };
  fs.writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify({ ccn: proof.ccn, status: result.status, bytes: bytes.length,
    error: result.error || '', output: path.relative(root, output) }, null, 2));
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
