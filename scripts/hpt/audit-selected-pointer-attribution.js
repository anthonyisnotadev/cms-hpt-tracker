'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../..');
const audit = path.join(root, 'data/hpt-audit');
const input = path.join(audit, 'nationwide-verification.json');
const output = path.join(audit, 'selected-pointer-attribution-discrepancies.json');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function collect(records) {
  return records.filter(row => row.pointer_corpus_sha256 && row.evidence?.pointer_sha256s?.length
    && !row.evidence.pointer_sha256s.includes(row.pointer_corpus_sha256))
    .map(row => ({
      ccn: row.ccn, hospital_name: row.hospital_name, state: row.state,
      disposition: row.disposition, observation_role: row.observation_role,
      standing_pointer_url: row.standing_pointer_url,
      selected_mrf_url: row.mrf_url,
      selected_header_pointer_sha256s: row.evidence.pointer_sha256s,
      attributed_pointer_checked_url: row.pointer_corpus_checked_url,
      attributed_pointer_sha256: row.pointer_corpus_sha256,
      attributed_pointer_observed_at: row.pointer_corpus_observed_at,
      attributed_pointer_raw_integrity: row.pointer_corpus_raw_integrity,
      next_action: 'Compare the selected file header’s source pointer version with the attributed current pointer bytes and exact CCN entry; preserve both dates and do not infer current file linkage from a differing hash.'
    })).sort((a, b) => a.ccn.localeCompare(b.ccn));
}

function main() {
  const bytes = fs.readFileSync(input);
  const report = JSON.parse(bytes);
  const records = collect(report.records);
  const summary = { source_nationwide_sha256: sha(bytes), source_generated_at: report.summary.generated_at,
    hospitals: report.summary.hospitals, discrepancies: records.length,
    active_verification_claims: records.filter(row => row.disposition.startsWith('verified-')
      && row.observation_role === 'current-observation').length,
    note: 'Different hashes are a version/provenance review, not by themselves a facility or file failure.' };
  fs.writeFileSync(output, JSON.stringify({ summary, records }, null, 2) + '\n');
  console.log(JSON.stringify(summary));
}

if (require.main === module) main();
module.exports = { collect };
